#!/usr/bin/env bash
# One-time: SES identities, IAM role, security group, key pair, EC2 t4g.small (encrypted gp3), Elastic IP. eu-central-1.
# Everything is tagged Project=mia.
# Idempotent where cheap: re-running reuses the SES identities, role, security group, key pair and a running "mia" instance.
set -euo pipefail
: "${AWS_PROFILE:?set AWS_PROFILE (e.g. mia)}"; : "${ALERT_TO:?carer email}"; : "${ALERT_FROM:?sender email}"
export AWS_REGION=eu-central-1
NAME=mia

for addr in $(printf '%s\n%s\n' "$ALERT_TO" "$ALERT_FROM" | sort -u); do
  aws sesv2 create-email-identity --email-identity "$addr" >/dev/null 2>&1 && echo "SES: verification mail sent to $addr" || echo "SES: $addr exists"
done

aws iam create-role --role-name $NAME-ec2 --tags Key=Project,Value=$NAME --assume-role-policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}' >/dev/null 2>&1 || true
aws iam put-role-policy --role-name $NAME-ec2 --policy-name ses-send --policy-document \
  "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"ses:SendEmail\",\"Resource\":\"*\",\"Condition\":{\"StringEquals\":{\"ses:FromAddress\":\"$ALERT_FROM\"}}}]}"
aws iam create-instance-profile --instance-profile-name $NAME-ec2 --tags Key=Project,Value=$NAME >/dev/null 2>&1 || true
aws iam add-role-to-instance-profile --instance-profile-name $NAME-ec2 --role-name $NAME-ec2 2>/dev/null || true

VPC=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
SG=$(aws ec2 describe-security-groups --filters Name=group-name,Values=$NAME Name=vpc-id,Values="$VPC" --query 'SecurityGroups[0].GroupId' --output text)
if [ "$SG" = "None" ]; then
  SG=$(aws ec2 create-security-group --group-name $NAME --description "Mia: https + ssh from owner" --vpc-id "$VPC" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=$NAME}]" --query GroupId --output text)
  aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 443 --cidr 0.0.0.0/0 >/dev/null
  aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 80 --cidr 0.0.0.0/0 >/dev/null
  aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22 --cidr "$(curl -fsS https://checkip.amazonaws.com)/32" >/dev/null
fi
echo "security group $SG (443, 80 open; 22 owner IP only)"

KEY=~/.ssh/$NAME-eu-central-1.pem
if [ ! -f "$KEY" ]; then
  (umask 077; aws ec2 create-key-pair --key-name $NAME --tag-specifications "ResourceType=key-pair,Tags=[{Key=Project,Value=$NAME}]" --query KeyMaterial --output text > "$KEY")
fi

ID=$(aws ec2 describe-instances --filters Name=tag:Name,Values=$NAME Name=instance-state-name,Values=pending,running,stopped \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)
if [ "$ID" = "None" ]; then
  AMI=$(aws ssm get-parameter --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text)
  # A fresh instance profile takes a few seconds to become usable by EC2: retry instead of a fixed sleep.
  for i in 1 2 3 4 5 6; do
    ID=$(aws ec2 run-instances --image-id "$AMI" --instance-type t4g.small --key-name $NAME --security-group-ids "$SG" \
      --iam-instance-profile Name=$NAME-ec2 --metadata-options HttpTokens=required \
      --block-device-mappings '[{"DeviceName":"/dev/xvda","Ebs":{"VolumeSize":16,"VolumeType":"gp3","Encrypted":true}}]' \
      --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=$NAME}]" "ResourceType=volume,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=$NAME}]" --query 'Instances[0].InstanceId' --output text) && break
    echo "run-instances failed (instance profile not ready yet?), retry $i in 10 s"; sleep 10
  done
fi
aws ec2 wait instance-running --instance-ids "$ID"

ALLOC=$(aws ec2 describe-addresses --filters Name=tag:Name,Values=$NAME --query 'Addresses[0].AllocationId' --output text)
if [ "$ALLOC" = "None" ]; then
  ALLOC=$(aws ec2 allocate-address --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$NAME},{Key=Project,Value=$NAME}]" --query AllocationId --output text)
fi
aws ec2 associate-address --instance-id "$ID" --allocation-id "$ALLOC" >/dev/null
IP=$(aws ec2 describe-addresses --allocation-ids "$ALLOC" --query 'Addresses[0].PublicIp' --output text)
echo "instance $ID  eip $ALLOC  ip $IP  ->  https://${IP//./-}.sslip.io   ssh -i $KEY ec2-user@$IP"
