# Mia on one server in Frankfurt (EC2 + Caddy + SES)

One t4g.small in eu-central-1 runs Mia Voice (local mode) behind Caddy:
`https://<ip-dashes>.sslip.io` serves the page and `/api` behind basic auth (user `mia`);
`/alexa` is open but only answers Alexa-signed requests for the configured skill.

## Prerequisites

- An AWS profile for Mia (`aws sts get-caller-identity --profile mia` works) with rights for
  EC2, IAM (role + instance profile), SSM (public AMI parameter) and SES in eu-central-1,
  plus `iam:PassRole` on the role `mia-ec2` (`run-instances` needs it to attach the instance role).
- Run everything from the repo root.

## Steps

1. Provision (once):

   ```bash
   export AWS_PROFILE=mia ALERT_TO=<carer-email> ALERT_FROM=<sender-email>
   bash deploy/aws/provision.sh
   ```

   Click the SES verification mail(s). Until then SES (sandbox) refuses to send.
   Re-running is safe: it reuses what exists, re-adds missing firewall rules, starts a stopped instance and
   opens SSH for your current IP. New instances get IMDSv2 with hop limit 1. An instance made by an older
   version of the script has hop limit 2; to match, run once:
   `aws ec2 modify-instance-metadata-options --instance-id <id> --http-tokens required --http-put-response-hop-limit 1`.
   Check: `aws sesv2 get-email-identity --email-identity <address> --query VerifiedForSendingStatus`.

2. Install (first deploy), then write the secrets on the server once:

   ```bash
   MIA_IP=<ip> bash deploy/aws/deploy.sh      # installs Node 24 (AL2023 package), pnpm, Caddy (release binary, sha512-checked);
                                              # services are not started until the secrets below exist
   ssh -i ~/.ssh/mia-eu-central-1.pem ec2-user@<ip>
   ```

   On the server, `/etc/mia/mia.env` (owner root, mode 600; read by systemd only):

   ```
   MIA_DEV_TOKEN=<openssl rand -hex 24>
   MIA_PROFILE=rose
   MIA_PUBLIC_ORIGIN=https://<ip-dashes>.sslip.io
   MIA_ALERT_EMAIL_TO=<carer-email>
   MIA_ALERT_EMAIL_FROM=<sender-email>
   AWS_REGION=eu-central-1
   MIA_ALEXA_SKILL_ID=<amzn1.ask.skill....>   # optional
   VOICE_PORT=8788
   ALEXA_PORT=8789
   ```

   Leave the LLM key out of this block. Append it without printing it, from your machine:
   `grep '^FEATHERLESS_API_KEY=' .env | ssh -i ~/.ssh/mia-eu-central-1.pem ec2-user@<ip> 'sudo tee -a /etc/mia/mia.env >/dev/null'`

   Page password: `caddy hash-password` on the server, then append
   `MIA_BASIC_HASH='<hash>'` to `/etc/mia/caddy.env` (mode 600; single quotes, the bcrypt hash contains `$`).
   Keep the clear password locally only (e.g. `.mia-data/basic-auth.txt`, gitignored).
   Then run `deploy.sh` again: it starts `mia` and `caddy`; Caddy gets a Let's Encrypt certificate for the sslip.io name.

3. Every change (redeploy, one command): `MIA_IP=<ip> bash deploy/aws/deploy.sh`.
   It deploys the current working tree, runs `pnpm install` and restarts `mia` and `caddy` (prints `active` twice).
   It syncs the working tree minus `.gitignore` (`.env`, `.mia-data` and private profiles stay local).
   Untracked files that are not ignored do ship; `.git/info/exclude` is not read.
   It also sets `/etc/mia/mia.env` to root, mode 600, every time.

4. Alexa (optional): add `MIA_ALEXA_SKILL_ID=<amzn1.ask.skill....>` to `/etc/mia/mia.env` and redeploy; until then
   `/alexa` answers 502 (nothing listens on 8789). Alexa developer console → Endpoint → HTTPS → `https://<ip-dashes>.sslip.io/alexa`,
   certificate option "My development endpoint has a certificate from a trusted certificate authority" (Let's Encrypt).

## When something changes

- **Your own IP changed** (SSH times out). Port 22 is open to one /32 only. Re-run `provision.sh`, or by hand:

  ```bash
  export AWS_PROFILE=mia AWS_REGION=eu-central-1
  SG=$(aws ec2 describe-security-groups --group-names mia --query 'SecurityGroups[0].GroupId' --output text)
  aws ec2 describe-security-groups --group-ids "$SG" --query 'SecurityGroups[0].IpPermissions[?FromPort==`22`].IpRanges[].CidrIp' --output text   # old /32
  aws ec2 revoke-security-group-ingress --group-id "$SG" --protocol tcp --port 22 --cidr <old-ip>/32
  aws ec2 authorize-security-group-ingress --group-id "$SG" --protocol tcp --port 22 --cidr "$(curl -fsS https://checkip.amazonaws.com)/32"
  ```

  `provision.sh` adds the new /32 but does not remove the old one: revoke it as above.

- **New instance on the same IP** (ssh says the host key changed): `ssh-keygen -R <ip>`, then deploy again.
- **New Elastic IP**: `deploy.sh` keeps the first `MIA_HOST` in `/etc/mia/caddy.env`. Edit that line and
  `MIA_PUBLIC_ORIGIN` in `/etc/mia/mia.env` to the new `<ip-dashes>.sslip.io`, then deploy again.
- **Demo recording with a set clock**: `/etc/mia/take.env` overrides `mia.env` (see `docs/submission/demo-video-script.md`).
  Remove it and restart `mia` when done.

## Checks

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://<host>/                       # 401
curl -s -o /dev/null -w '%{http_code}\n' -u mia:<pw> https://<host>/           # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<host>/alexa -H 'content-type: application/json' -d '{}'   # 403 (502 without MIA_ALEXA_SKILL_ID)
ssh -i ~/.ssh/mia-eu-central-1.pem ec2-user@<ip> 'sudo journalctl -u mia -n 50 --no-pager'
```

## Costs

t4g.small ~0.02 USD/h (~15 USD/month), 16 GB gp3 ~1.5 USD/month, public IPv4 / Elastic IP ~3.6 USD/month,
SES ~0 at this volume.

All resources are tagged `Project=mia` (find them: `aws resourcegroupstaggingapi get-resources --tag-filters Key=Project,Values=mia`).

## Stop / remove

```bash
export AWS_PROFILE=mia AWS_REGION=eu-central-1
ID=$(aws ec2 describe-instances --filters Name=tag:Name,Values=mia Name=tag:Project,Values=mia Name=instance-state-name,Values=running,stopped --query 'Reservations[0].Instances[0].InstanceId' --output text)
[ "$ID" != None ] || echo "no mia instance"
aws ec2 stop-instances --instance-ids "$ID"          # pause (disk + IP still billed)

# remove everything (stop at the first error)
ALLOC=$(aws ec2 describe-addresses --filters Name=tag:Name,Values=mia Name=tag:Project,Values=mia --query 'Addresses[0].AllocationId' --output text)
[ "$ID" != None ] && aws ec2 terminate-instances --instance-ids "$ID" && aws ec2 wait instance-terminated --instance-ids "$ID"
[ "$ALLOC" != None ] && aws ec2 release-address --allocation-id "$ALLOC"
aws ec2 delete-security-group --group-name mia
aws ec2 delete-key-pair --key-name mia && rm ~/.ssh/mia-eu-central-1.pem
aws iam remove-role-from-instance-profile --instance-profile-name mia-ec2 --role-name mia-ec2
aws iam delete-instance-profile --instance-profile-name mia-ec2
aws iam delete-role-policy --role-name mia-ec2 --policy-name ses-send
aws iam delete-role --role-name mia-ec2
aws sesv2 list-email-identities --query 'EmailIdentities[].IdentityName' --output text   # ALERT_TO and ALERT_FROM
aws sesv2 delete-email-identity --email-identity <address>                              # once per address
ssh-keygen -R <ip>                    # the server's host key
rm -f .mia-data/basic-auth.txt        # the local page password
```
