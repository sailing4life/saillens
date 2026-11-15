# Serves the single-file app. All sailing data stays in the visitor's browser.
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY SailLens.html /srv/index.html
