# Bluesky Firehose -> Loki Consumer

A consumer that takes the Bluesky firehose and logs it to Loki for analysis.

Requires a valid LOKI_URL and PROM_URL to operate - these the subject of regular healthchecks to ensure everything is captured.

See .env.example for additional configuration.

## Running

This is designed to run as part of a bigger docker stack that includes the grafana stack, but docker-compose.yml is sufficient to simply launch and run with a minimal stack.

Launch with `docker compose build` then `docker compose up -d`, then visit http://localhost:3000/ in a browser.

NOTE: You will probably want to uncomment and adjust the volume paths in the docker-compose to persist data.

## Dashboard

There is an example dashboard in grafana_dashboard you can import into grafana as a starting example.