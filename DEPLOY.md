# Deploying SailLens

Hosted copy: https://saillens-production.up.railway.app (Railway project "SailLens", service "saillens").

The service builds from the GitHub repository `sailing4life/saillens` using the `Dockerfile` (Caddy serving `SailLens.html`).

    python3 build.py          # rebuild SailLens.html from src/
    node tests/smoke.js       # engine tests on the built-in example data
    git commit -am "..." && git push

If a push does not start a deployment on Railway, reconnect the repository as the service's source (Railway dashboard, service settings, Source) or redeploy from there.
