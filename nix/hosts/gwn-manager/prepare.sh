set -euo pipefail
root=/var/lib/gwn-manager
install -d -m 0700 -o gwn -g gwn "$root"
if [[ -e /gwn && ! -L /gwn ]]; then
  printf '%s\n' 'Refusing unmanaged /gwn directory' >&2
  exit 1
fi
ln -sfn "$root" /gwn
if [[ ! -f "$root/.owl-package" ]]; then
  [[ -z "$(find "$root" -mindepth 1 -maxdepth 1 -print -quit)" ]]
  printf '%s\n' "$GWN_PACKAGE" > "$root/.owl-package"
  cp -r "$GWN_PACKAGE/conf" "$GWN_PACKAGE/data" "$root/"
  chmod -R u+rwX,go-rwx "$root/conf" "$root/data"
  for directory in bin apps scripts sql; do
    ln -s "$GWN_PACKAGE/$directory" "$root/$directory"
  done
  ln -s "$GWN_PACKAGE/gwn" "$root/gwn"
  install -d -m 0700 "$root/logs" "$root/run" "$root/upgrade"
  cp "$root/conf/gwn.conf_default" "$root/conf/gwn.conf"
fi
previous_package=$(cat "$root/.owl-package")
if [[ "$previous_package" != "$GWN_PACKAGE" ]]; then
  cmp "$previous_package/apps/version" "$GWN_PACKAGE/apps/version"
  for directory in bin apps scripts sql; do
    [[ "$(readlink "$root/$directory")" == "$previous_package/$directory" ]]
    ln -sfn "$GWN_PACKAGE/$directory" "$root/$directory"
  done
  [[ "$(readlink "$root/gwn")" == "$previous_package/gwn" ]]
  ln -sfn "$GWN_PACKAGE/gwn" "$root/gwn"
  printf '%s\n' "$GWN_PACKAGE" > "$root/.owl-package.next"
  mv "$root/.owl-package.next" "$root/.owl-package"
fi
[[ "$(readlink "$root/bin")" == "$GWN_PACKAGE/bin" ]]
sed -i \
  -e "s/^access_address=.*/access_address=$GWN_ADDRESS/" \
  -e 's/^read_ssh_port=.*/read_ssh_port=false/' \
  -e 's/^gwnrc_enable=.*/gwnrc_enable=0/' \
  "$root/conf/gwn.conf"
install -d -m 0700 "$root/data/nginx/client" "$root/data/nginx/proxy" \
  "$root/data/nginx/fastcgi" "$root/data/nginx/uwsgi" "$root/data/nginx/scgi"
for template in "$root"/conf/nginx/nginx.conf_temp*; do
  if ! grep -Fq 'client_body_temp_path /gwn/data/nginx/client;' "$template"; then
    sed -i -z 's/http[[:space:]]*{/http {\n    client_body_temp_path \/gwn\/data\/nginx\/client; proxy_temp_path \/gwn\/data\/nginx\/proxy; fastcgi_temp_path \/gwn\/data\/nginx\/fastcgi; uwsgi_temp_path \/gwn\/data\/nginx\/uwsgi; scgi_temp_path \/gwn\/data\/nginx\/scgi;/' "$template"
  fi
  grep -Fq 'client_body_temp_path /gwn/data/nginx/client;' "$template"
done
chown -R gwn:gwn "$root"
if [[ ! -f "$root/.owl-initialized" ]]; then
  /gwn/scripts/upgrade_config.sh
  /gwn/scripts/db_operation.sh init
  [[ -f /gwn/data/gwn/cert/ca.pem ]] || /gwn/scripts/create_cert.sh gateway
  [[ -f /gwn/data/nginx/cert/gwn.manager.crt ]] || /gwn/scripts/create_cert.sh nginx 1
  bash -c '. /gwn/scripts/functions; [[ -f "$SSO_CERT_FILE" ]] || generate_sso_cert'
  runuser -u gwn -- /gwn/bin/gwn/redis-ctl start
  runuser -u gwn -- /gwn/bin/gwn/mysql-ctl start
  bash -c '. /gwn/scripts/functions; set_deploy_log initialization.log; db_connect_test'
  /gwn/scripts/db_operation.sh upgrade
  touch "$root/.owl-initialized"
fi
chown -R gwn:gwn "$root"