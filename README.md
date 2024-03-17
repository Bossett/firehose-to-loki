# Bluesky Firehose -> Loki Consumer

A consumer that takes the Bluesky firehose and logs it to Loki for analysis.

Requires a valid LOKI_URL and PROM_URL to operate - these the subject of regular healthchecks to ensure everything is captured.

See .env.example for additional configuration.