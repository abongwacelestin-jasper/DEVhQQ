#!/usr/bin/env bash
# TavetaHQ CYBER phase-2 — Docker stack hardening audit (host-side, read-only).
#
# Local only. Uses `docker` / `docker compose` on the host plus in-container
# interpreters that already exist (models = python). No destructive actions.
# Prints one PASS/FAIL/SKIP line per control. Exit non-zero if any control FAILs.
#
# Run from the repo root:  bash security-tests/docker/infra-audit.sh
set -u
PROJECT="${DEVHQ_PROJECT:-devhq}"
fail=0
pass_line(){ printf '[PASS] %s\n' "$1"; }
fail_line(){ printf '[FAIL] %s\n' "$1"; fail=1; }
skip_line(){ printf '[SKIP] %s\n' "$1"; }

c(){ echo "${PROJECT}-$1-1"; }

if ! docker ps >/dev/null 2>&1; then echo "[SKIP] docker unavailable"; exit 2; fi
if ! docker inspect "$(c backend)" >/dev/null 2>&1; then echo "[SKIP] stack not running (${PROJECT}-*)"; exit 2; fi

echo "== Published ports (only the edge should expose host ports) =="
for svc in backend frontend postgres minio models; do
  ports=$(docker inspect "$(c "$svc")" --format '{{json .NetworkSettings.Ports}}' 2>/dev/null)
  if echo "$ports" | grep -q 'HostPort'; then fail_line "$svc publishes a host port: $ports"; else pass_line "$svc exposes no host port"; fi
done

echo "== Hardening (rootfs / user / caps / privileges) per service =="
for svc in edge frontend backend models postgres minio; do
  fmt='ro={{.HostConfig.ReadonlyRootfs}} user={{.Config.User}} priv={{.HostConfig.Privileged}} capdrop={{.HostConfig.CapDrop}} capadd={{.HostConfig.CapAdd}} secopt={{.HostConfig.SecurityOpt}}'
  line=$(docker inspect "$(c "$svc")" --format "$fmt" 2>/dev/null)
  echo "   $svc: $line"
  case "$line" in *priv=true*) fail_line "$svc runs privileged" ;; esac
  case "$line" in *user:\ *|*"user= "*) : ;; esac
done

echo "== Network segmentation (which networks each service joins) =="
for svc in edge frontend backend models postgres minio; do
  nets=$(docker inspect "$(c "$svc")" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null)
  echo "   $svc -> $nets"
done

echo "== Reachability: can edge/frontend reach data-tier services? (models=python prober) =="
# Use the models container (python) only as an available TCP prober for NEGATIVE
# controls would be wrong (models is allowed to reach minio). Instead inspect
# whether edge/frontend share a network with postgres/minio/models at all.
dataprobe(){ # $1 = source svc, $2 = target svc
  local a b shared
  a=$(docker inspect "$(c "$1")" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}},{{end}}' 2>/dev/null)
  b=$(docker inspect "$(c "$2")" --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}},{{end}}' 2>/dev/null)
  shared=""
  IFS=',' read -ra AN <<< "$a"
  for n in "${AN[@]}"; do [ -n "$n" ] && echo "$b" | grep -q "$n" && shared="$shared $n"; done
  echo "$shared"
}
for pair in "edge postgres" "edge minio" "edge models" "frontend postgres" "frontend minio" "frontend models"; do
  set -- $pair
  s=$(dataprobe "$1" "$2")
  if [ -n "$s" ]; then fail_line "$1 shares a network with $2 ($s) — data tier reachable from the edge/frontend"; else pass_line "$1 is segmented from $2"; fi
done
# Backend SHOULD reach postgres/minio/models (positive control).
for pair in "backend postgres" "backend minio" "backend models"; do
  set -- $pair
  s=$(dataprobe "$1" "$2")
  if [ -n "$s" ]; then pass_line "backend can reach $2 (expected)"; else fail_line "backend cannot reach $2 — app would be broken"; fi
done

echo "== Secrets in images (docker history + image env) =="
for svc in backend models; do
  img=$(docker inspect "$(c "$svc")" --format '{{.Image}}' 2>/dev/null)
  hist=$(docker history --no-trunc "$img" 2>/dev/null)
  envs=$(docker image inspect "$img" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null)
  hits=$(printf '%s\n%s\n' "$hist" "$envs" | grep -iE 'SESSION_SECRET=|DATA_ENCRYPTION_KEY=|ML_SERVICE_TOKEN=|S3_SECRET|DEMO_PASSWORD=|PASSWORD=[^$]|SECRET=[A-Za-z0-9]{8}|PRIVATE KEY' | grep -vE '=\s*$|=\$\{|ARG |=""' )
  if [ -n "$hits" ]; then fail_line "$svc image may bake a secret:"; echo "$hits" | sed 's/^/        /'; else pass_line "$svc image: no secret value found in history/env"; fi
done

echo "== MinIO anonymous access (probed from the models container via python) =="
minio_probe='
import json,urllib.request,urllib.error,sys
host="http://minio:9000"
buckets=["devhq-uploads","devhq-backups","devhq-audit","devhq-models"]
bad=[]
for b in buckets:
    try:
        r=urllib.request.urlopen(host+"/"+b+"/?list-type=2",timeout=4)
        body=r.read(200).decode("utf-8","replace")
        bad.append(b+" -> HTTP "+str(r.status))
    except urllib.error.HTTPError as e:
        # 403/401 = anonymous denied (good). 200 = anonymous list (bad).
        if e.code in (401,403): pass
        else: bad.append(b+" -> HTTP "+str(e.code))
    except Exception as e:
        print("probe-error "+b+": "+str(e))
print("ANON_BAD="+json.dumps(bad))
'
if docker inspect "$(c models)" >/dev/null 2>&1; then
  out=$(docker exec "$(c models)" python -c "$minio_probe" 2>&1)
  echo "   $out"
  if echo "$out" | grep -q 'ANON_BAD=\[\]'; then pass_line "MinIO denies anonymous bucket listing"; else fail_line "MinIO anonymous access: $out"; fi
else
  skip_line "models container unavailable for MinIO probe"
fi

echo
if [ "$fail" -ne 0 ]; then echo "RESULT: FAIL (one or more controls)"; exit 1; else echo "RESULT: PASS"; exit 0; fi
