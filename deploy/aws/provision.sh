#!/usr/bin/env bash
# One-time: SES identities, IAM role, security group, key pair, EC2 t4g.small (encrypted gp3), Elastic IP. eu-central-1.
# Everything is tagged Project=mia.
# Safe to re-run: it reuses what exists, re-adds missing firewall rules, starts a stopped "mia" instance,
# and opens SSH for your current IP (the old /32 stays until you remove it, see README.md).
set -euo pipefail
: "${AWS_PROFILE:?set AWS_PROFILE (e.g. mia)}"; : "${ALERT_TO:?carer email}"; : "${ALERT_FROM:?sender email}"
export AWS_REGION=eu-central-1
NAME=mia
TAGS="{Key=Name,Value=$NAME},{Key=Project,Value=$NAME}"

# Run an AWS call; an error whose text matches $1 (e.g. "already exists") is fine, any other error stops the script.
ok_if() {
  local pat=$1 err; shift
  if ! err=$("$@" 2>&1 >/dev/null); then
    grep -qE "$pat" <<<"$err" || { echo "$err" >&2; exit 1; }
    return 1
  fi
}

for addr in $(printf '%s\n%s\n' "$ALERT_TO" "$ALERT_FROM" | sort -u); do
  if ok_if AlreadyExists aws sesv2 create-email-identity --email-identity "$addr"; then
    echo "SES: verification mail sent to $addr"
  else
    echo "SES: $addr exists"
  fi
done

ok_if EntityAlreadyExists aws iam create-role --role-name $NAME-ec2 --tags Key=Project,Value=$NAME --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' || true
aws iam put-role-policy --role-name $NAME-ec2 --policy-name ses-send --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"ses:SendEmail\",\"Resource\":\"*\",\"Condition\":{\"StringEquals\":{\"ses:FromAddress\":\"$ALERT_FROM\"}}}]}"
ok_if EntityAlreadyExists aws iam create-instance-profile --instance-profile-name $NAME-ec2 --tags Key=Project,Value=$NAME || true
ok_if LimitExceeded aws iam add-role-to-instance-profile --instance-profile-name $NAME-ec2 --role-name $NAME-ec2 || true

MYIP=$(curl -fsS --max-time 10 https://checkip.amazonaws.com) || { echo "could not get your public IP from checkip.amazonaws.com" >&2; exit 1; }
VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=$NAME Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG" = "None" ]; then
  SG=$(aws ec2 create-security-group --group-name $NAME --description "Mia: https + ssh from owner" --vpc-id "$VPC" \
    --tag-specifications "ResourceType=security-group,Tags=[$TAGS]" --query GroupId --output text)
fi
# Every run: add each rule; "already there" is fine. This also repairs a group left half-done by an interrupted run.
ok_if InvalidPermission.Duplicate aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 443 --cidr 0.0.0.0/0 || true
ok_if InvalidPermission.Duplicate aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 80 --cidr 0.0.0.0/0 || true
ok_if InvalidPermission.Duplicate aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22 --cidr "$MYIP/32" || true
echo "security group $SG (443, 80 open; 22 from $MYIP/32 and any owner IP added before)"

KEY=~/.ssh/$NAME-eu-central-1.pem
if [ ! -s "$KEY" ]; then
  if aws ec2 describe-key-pairs --key-names $NAME >/dev/null 2>&1; then
    echo "key pair $NAME exists in AWS but not in $KEY: restore the .pem, or delete the key pair in AWS and re-run" >&2; exit 1
  fi
  # Write to a temp file first: a failed call must not leave an empty .pem that later runs would trust.
  if ! (umask 077; aws ec2 create-key-pair --key-name $NAME --tag-specifications "ResourceType=key-pair,Tags=[{Key=Project,Value=$NAME}]" \
    --query KeyMaterial --output text > "$KEY.tmp"); then
    rm -f "$KEY.tmp"; exit 1
  fi
  mv "$KEY.tmp" "$KEY"
fi

FOUND=$(aws ec2 describe-instances \
  --filters Name=tag:Name,Values=$NAME Name=tag:Project,Values=$NAME Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'Reservations[0].Instances[0].[InstanceId,State.Name]' --output text)
read -r ID STATE <<<"$FOUND"
if [ "$ID" = "None" ]; then
  AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text)
  # A fresh instance profile takes a few seconds to become usable by EC2: retry instead of a fixed sleep.
  ID=
  for i in 1 2 3 4 5 6; do
    ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type t4g.small --key-name $NAME --security-group-ids "$SG" \
      --iam-instance-profile Name=$NAME-ec2 --metadata-options HttpTokens=required,HttpPutResponseHopLimit=1 \
      --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":16,"VolumeType":"gp3","Encrypted":true}}]' \
      --tag-specifications "ResourceType=instance,Tags=[$TAGS]" "ResourceType=volume,Tags=[$TAGS]" --query 'Instances[0].InstanceId' --output text) && break
    ID=
    echo "run-instances failed (instance profile not ready yet?), retry $i in 10 s"; sleep 10
  done
  [ -n "$ID" ] && [ "$ID" != "None" ] || { echo "run-instances failed 6 times: see the errors above" >&2; exit 1; }
elif [ "$STATE" = "stopping" ] || [ "$STATE" = "stopped" ]; then
  aws ec2 wait instance-stopped --instance-ids "$ID"
  aws ec2 start-instances --instance-ids "$ID" >/dev/null
  echo "started stopped instance $ID"
fi
aws ec2 wait instance-running --instance-ids "$ID"

ALLOC=$(aws ec2 describe-addresses --filters Name=tag:Name,Values=$NAME Name=tag:Project,Values=$NAME --query 'Addresses[0].AllocationId' --output text)
if [ "$ALLOC" = "None" ]; then
  ALLOC=$(aws ec2 allocate-address --tag-specifications "ResourceType=elastic-ip,Tags=[$TAGS]" --query AllocationId --output text)
fi
aws ec2 associate-address --instance-id "$ID" --allocation-id "$ALLOC" >/dev/null
IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)
echo "instance $ID  eip $ALLOC  ip $IP  ->  https://${IP//./-}.sslip.io   ssh -i $KEY ec2-user@$IP"
