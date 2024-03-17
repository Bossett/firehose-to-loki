# Bluesky Firehose -> Loki Consumer

A consumer that takes the Bluesky firehose and logs it to Loki for analysis.

Requires a valid LOKI_URL and PROM_URL to operate - these the subject of regular healthchecks to ensure everything is captured.

See .env.example for additional configuration.

## Running

This is designed to run as part of a bigger docker stack that includes the grafana stack, but docker-compose.yml is sufficient to simply launch and run with a minimal stack.

The easiest way to just run the tool is using the included Docker compose. With [Docker](https://docs.docker.com/get-docker/) installed, launch with `docker compose up --build -d`, then visit http://localhost:3000/ in a browser.

NOTE: Both Loki & Grafana will persist data in named volumes, uncomment the bind path if you'd rather this be a specific folder.

## Dashboard

There is an example dashboard in grafana_dashboard you can import into grafana as a starting example.

## Metrics

There are some additional metrics exposed to tools such as Prometheus. You will need to expose the port (default 8080) in the compose. The container will report its own memory, network, etc. usage, which is useful if you want to know how the bandwitch volume of the firehose.