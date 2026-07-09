#!/bin/sh
set -e

# Fall back to PORT if LOCAL_PORT is unset (tdr-code passes PORT via env_file).
LOCAL_PORT="${LOCAL_PORT:-${PORT}}"
export LOCAL_PORT

# Create the extra locations dir and a placeholder conf so the include glob
# in nginx.conf.template never fails on services with no extra locations.
mkdir -p /etc/nginx/conf.d/extra
echo "# placeholder" > /etc/nginx/conf.d/extra/placeholder.conf

# Render any service-specific location templates from extra-src/ (e.g. SSE
# endpoints). Files ending in .conf are processed with envsubst for LOCAL_PORT
# and written to extra/ where nginx picks them up via the include directive.
if [ -d /etc/nginx/conf.d/extra-src ]; then
  for tmpl in /etc/nginx/conf.d/extra-src/*.conf; do
    [ -f "$tmpl" ] || continue
    envsubst '${LOCAL_PORT}' < "$tmpl" \
      > "/etc/nginx/conf.d/extra/$(basename "$tmpl")"
  done
fi

# Render the unreachable page from the shared template.
envsubst '${SERVICE_LABEL} ${UNREACHABLE_DESCRIPTION}' \
  < /local-proxy/unreachable.html.template \
  > /usr/share/nginx/html/unreachable.html

exec /docker-entrypoint.sh "$@"
