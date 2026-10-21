Hostinger VPS deployment
=======================

This configuration is for Ubuntu 24.04 with Nginx, systemd and Node.js 22
installed at /usr/local/bin/node. It adds a separate service and virtual hosts;
do not replace the VPS's global Nginx configuration or other applications.

Layout:
  /var/www/zinda-play/releases/<release>/server
  /var/www/zinda-play/releases/<release>/client/dist
  /var/www/zinda-play/current -> releases/<release>
  /var/www/zinda-play/shared/server.env (root:zinda-play, mode 0640)
  /var/www/zinda-play/current/server/.env -> shared/server.env
  /var/www/zinda-play/config/proxy.conf
  /var/www/zinda-play/acme

Build the frontend with VITE_API_URL=https://api.zindaplay.com and npm run build
from client. VITE_API_URL is an origin, not a URL ending in /api.
Install backend dependencies from server with npm ci --omit=dev.
Never package node_modules, local .env files, or unrelated application files.
Transfer backend secrets separately over SSH; never commit them.

Set these overrides in the shared server.env, retaining existing service keys:
  NODE_ENV=production
  HOST=127.0.0.1
  PORT=4100
  CLIENT_ORIGIN=https://zindaplay.com,https://www.zindaplay.com
  PUBLIC_WEB_URL=https://zindaplay.com
  PUBLIC_API_URL=https://api.zindaplay.com
  TRUST_PROXY_HOPS=1

TRUST_PROXY_HOPS=1 assumes the direct, single Nginx proxy configured here.
The proxy overwrites forwarded IP headers; do not expose port 4100 publicly.
Review this setting before adding another proxy such as Cloudflare.
Keep VIEW_IP_HASH_SECRET unchanged when migrating; if unset, the application
uses ADMIN_PASSWORD. Changing either active secret resets viewer IP identities.
MAXMIND_DB_PATH, when configured, must point to a readable existing database.
Razorpay requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET for payments.

Create a dedicated non-login zinda-play system user, owned release directories,
and a root-owned shared directory accessible to its group.
Install zinda-play.service into /etc/systemd/system, then run:
  systemd-analyze verify /etc/systemd/system/zinda-play.service
  systemctl daemon-reload
  systemctl enable --now zinda-play
  curl --fail http://127.0.0.1:4100/api/health

Copy proxy.conf into /var/www/zinda-play/config.
Install zinda-play.nginx.conf into /etc/nginx/sites-available/zinda-play and
symlink it into /etc/nginx/sites-enabled. Run nginx -t before reloading Nginx.
Test both virtual hosts with curl --resolve before changing DNS.
Verify video/creator share routes, referral links, APK headers and assetlinks.

DNS at the authoritative provider (GoDaddy for this domain):
  A @   72.60.203.149
  A api 72.60.203.149
  CNAME www zindaplay.com
Replace conflicting web A/AAAA/CNAME records only; preserve MX/TXT/email records.
Record previous values for rollback. DNS changes require authenticated access.

After all three hostnames resolve to the VPS, provision HTTPS:
  certbot --nginx -d zindaplay.com -d www.zindaplay.com -d api.zindaplay.com --redirect
  certbot renew --dry-run
Verify HTTPS frontend, /api/health, API CORS, data routes, and APK checksum.
Do not declare the migration live until public DNS and HTTPS checks pass.

Update deployments by creating a new release and switching current atomically.
Restart only zinda-play, then verify its health and Nginx routes.
Rollback application files by restoring the prior current symlink and
restarting zinda-play. This does not reverse database changes.

Android releases from 1.0.17+18 default to https://api.zindaplay.com.
Older installed APKs still use Render. Keep Render available until users
have upgraded; publishing a new website APK does not update installed apps.
Existing tokens may need a fresh login across the two backend instances.
