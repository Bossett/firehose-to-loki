#!/bin/sh

sleep_duration=1
max_sleep_duration=900
retry_interval=30
last_crash=$(date +%s)

until yarn --silent start; do
    last_exit_code=$?
    
    current_time=$(date +%s)
    time_since_last_crash=$((current_time - last_crash))

    if [ $time_since_last_crash -gt 600 ]; then
        sleep_duration=5
    else
        sleep_duration=$((sleep_duration * 5 < max_sleep_duration ? sleep_duration * 5 : max_sleep_duration))
    fi

    echo "Crashed with exit code $last_exit_code. Respawning in $sleep_duration seconds..."

    sleep $sleep_duration

    ps -aux | grep '[n]ode' | awk '{print $2}' | xargs -r kill

    while ! curl --output /dev/null --silent --fail "$LOKI_URL/ready"; do
        echo "Unable to reach LOKI_URL: $LOKI_URL/ready. Retrying in $retry_interval seconds..."
        sleep $retry_interval
    done

    last_crash=$(date +%s)
done
