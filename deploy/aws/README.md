# Mia on one server in Frankfurt (EC2 + Caddy + SES)

One t4g.small in eu-central-1 runs Mia Voice (local mode) behind Caddy:
`https://<ip-dashes>.sslip.io` serves the page and `/api` behind basic auth (user `mia`);
`/alexa` is open but only answers Alexa-signed requests for the configured skill.

## Prerequisites

- An AWS profile for Mia (`aws sts get-caller-identity --profile mia` works) with rights for
  EC2, IAM (role + instance profile), SSM (public AMI parameter) and SES in eu-central-1.
- Run everything from the repo root.

## Steps

1. Provision (once):

   ```bash
   export AWS_PROFILE=mia ALERT_TO=<carer-email> ALERT_FROM=<sender-email>
   bash deploy/aws/provision.sh
   ```

   Click the SES verification mail(s). Until then SES (sandbox) refuses to send.
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
   FEATHERLESS_API_KEY=<key>
   MIA_PROFILE=rose
   MIA_PUBLIC_ORIGIN=https://<ip-dashes>.sslip.io
   MIA_ALERT_EMAIL_TO=<carer-email>
   MIA_ALERT_EMAIL_FROM=<sender-email>
   AWS_REGION=eu-central-1
   MIA_ALEXA_SKILL_ID=<amzn1.ask.skill....>   # optional
   VOICE_PORT=8788
   ALEXA_PORT=8789
   ```

   Copy the LLM key without printing it, from your machine:
   `grep '^FEATHERLESS_API_KEY=' .env | ssh -i ~/.ssh/mia-eu-central-1.pem ec2-user@<ip> 'sudo tee -a /etc/mia/mia.env >/dev/null'`

   Page password: `caddy hash-password` on the server, then append
   `MIA_BASIC_HASH='<hash>'` to `/etc/mia/caddy.env` (mode 600; single quotes, the bcrypt hash contains `$`).
   Keep the clear password locally only (e.g. `.mia-data/basic-auth.txt`, gitignored).
   Then run `deploy.sh` again: it starts `mia` and `caddy`; Caddy gets a Let's Encrypt certificate for the sslip.io name.

3. Every change (redeploy, one command): `MIA_IP=<ip> bash deploy/aws/deploy.sh`.
   It deploys the current working tree, runs `pnpm install` and restarts `mia` and `caddy` (prints `active` twice).
   It syncs only what git would track (`.gitignore` applies: `.env`, `.mia-data` and private profiles stay local).

4. Alexa (optional): add `MIA_ALEXA_SKILL_ID=<amzn1.ask.skill....>` to `/etc/mia/mia.env` and redeploy; until then
   `/alexa` answers 502 (nothing listens on 8789). Alexa developer console → Endpoint → HTTPS → `https://<ip-dashes>.sslip.io/alexa`,
   certificate option "My development endpoint has a certificate from a trusted certificate authority" (Let's Encrypt).

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
ID=$(aws ec2 describe-instances --filters Name=tag:Name,Values=mia Name=instance-state-name,Values=running,stopped --query 'Reservations[0].Instances[0].InstanceId' --output text)
aws ec2 stop-instances --instance-ids $ID            # pause (disk + IP still billed)

# remove everything
ALLOC=$(aws ec2 describe-addresses --filters Name=tag:Name,Values=mia --query 'Addresses[0].AllocationId' --output text)
aws ec2 terminate-instances --instance-ids $ID && aws ec2 wait instance-terminated --instance-ids $ID
aws ec2 release-address --allocation-id $ALLOC
aws ec2 delete-security-group --group-name mia
aws ec2 delete-key-pair --key-name mia && rm ~/.ssh/mia-eu-central-1.pem
aws iam remove-role-from-instance-profile --instance-profile-name mia-ec2 --role-name mia-ec2
aws iam delete-instance-profile --instance-profile-name mia-ec2
aws iam delete-role-policy --role-name mia-ec2 --policy-name ses-send
aws iam delete-role --role-name mia-ec2
aws sesv2 delete-email-identity --email-identity <address>
```
