# Deploying SailLens

Hosted copy: https://saillens-production.up.railway.app (Railway project "SailLens", service "saillens").

The repository Dockerfile serves the HTML app and session API with Python. Mount a persistent Railway volume at `/data` for `saillens.sqlite3` and run one application replica. The service verifies the mount at startup on Railway. `GET /api/health` checks database connectivity.

For local development set `SAILLENS_DATA_DIR` to a writable directory and run `python3 server.py`. The default port is 8080. Run `python3 -m unittest discover -s tests -p 'test_server.py'` and `npm test` for server and browser integration checks.

    python3 build.py          # rebuild SailLens.html from src/
    node tests/smoke.js       # engine tests on the built-in example data
    git commit -am "..." && git push

If a push does not start a deployment on Railway, reconnect the repository as the service's source (Railway dashboard, service settings, Source) or redeploy from there.
