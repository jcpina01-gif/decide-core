#!/usr/bin/env bash
# Reinicia / recarrega o Gunicorn do KPI (Linux) — mesmo padrão que na VM:
#   gunicorn -w 2 -b 127.0.0.1:5000 --timeout 120 kpi_server:app
#
# Uso:
#   ./backend/scripts/restart_decide_kpi_gunicorn.sh
#   ./backend/scripts/restart_decide_kpi_gunicorn.sh /home/jcpina01/decide-core
#   DECIDE_KPI_REPO_ROOT=/path/to/decide-core ./backend/scripts/restart_decide_kpi_gunicorn.sh
#
# Modos:
#   (defeito)  envia SIGHUP ao master → workers recarregam kpi_server.py do disco
#   --full     SIGTERM ao master; espera; volta a arrancar com nohup (se o Gunicorn não for systemd)
#
set -euo pipefail

MODE="hup"
if [[ "${1:-}" == "--full" ]]; then
  MODE="full"
  shift || true
fi

ROOT="${DECIDE_KPI_REPO_ROOT:-${DECIDE_PROJECT_ROOT:-}}"
if [[ -z "$ROOT" && -n "${1:-}" ]]; then
  ROOT="$1"
  shift || true
fi
if [[ -z "$ROOT" ]]; then
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
fi
ROOT="$(cd "$ROOT" && pwd)"

KPI_PY="$ROOT/kpi_server.py"
if [[ ! -f "$KPI_PY" ]]; then
  echo "ERRO: não encontro kpi_server.py em $KPI_PY" >&2
  exit 1
fi

PORT="${PORT:-5000}"
WORKERS="${GUNICORN_WORKERS:-2}"
TIMEOUT="${GUNICORN_TIMEOUT:-120}"
BIND="${GUNICORN_BIND:-127.0.0.1:${PORT}}"
VENV_GUNICORN="${GUNICORN_BIN:-$ROOT/.venv-kpi/bin/gunicorn}"
if [[ ! -x "$VENV_GUNICORN" ]]; then
  echo "AVISO: não encontro $VENV_GUNICORN — ajusta GUNICORN_BIN ou cria .venv-kpi" >&2
fi

# Master Gunicorn: PPID 1 (init/systemd) e linha de comando com kpi_server:app
find_master_pid() {
  local pid ppid cmd
  while read -r pid; do
    [[ -z "$pid" ]] && continue
    ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
    cmd="$(tr '\0' ' ' <"/proc/$pid/cmdline" 2>/dev/null || true)"
    if [[ "$ppid" == "1" ]] && echo "$cmd" | grep -qiE 'gunicorn'; then
      if echo "$cmd" | grep -qi 'kpi_server:app'; then
        echo "$pid"
        return 0
      fi
    fi
  done < <(pgrep -f 'gunicorn' 2>/dev/null || true)
  return 1
}

health_curl() {
  local url="http://127.0.0.1:${PORT}/api/health"
  if command -v curl >/dev/null 2>&1; then
    curl -sS --connect-timeout 5 "$url" || true
  else
    echo "(instala curl para ver /api/health)" >&2
  fi
}

MASTER="$(find_master_pid || true)"
if [[ -z "${MASTER:-}" ]]; then
  echo "KPI: nenhum master Gunicorn encontrado (PPID=1 + kpi_server:app)." >&2
  if [[ "$MODE" == "full" && -x "$VENV_GUNICORN" ]]; then
    echo "KPI: arranque (--full) em $ROOT ..."
    cd "$ROOT"
    nohup "$VENV_GUNICORN" -w "$WORKERS" -b "$BIND" --timeout "$TIMEOUT" kpi_server:app >>/tmp/decide-kpi-gunicorn.log 2>&1 &
    disown || true
    sleep 3
    echo "KPI: /api/health →"
    health_curl
    echo ""
    exit 0
  fi
  echo "Dica: git pull na VM e depois ./restart_decide_kpi_gunicorn.sh --full $ROOT" >&2
  exit 1
fi

echo "KPI: master Gunicorn PID=$MASTER (repo=$ROOT)"

if [[ "$MODE" == "hup" ]]; then
  if ! kill -HUP "$MASTER" 2>/dev/null; then
    echo "ERRO: kill -HUP falhou (tenta com sudo ou corre como root)." >&2
    exit 1
  fi
  echo "KPI: enviei SIGHUP ao master (workers devem recarregar o código)."
  sleep 2
  echo "KPI: /api/health →"
  health_curl
  echo ""
  exit 0
fi

# --full
echo "KPI: SIGTERM ao master $MASTER ..."
if ! kill -TERM "$MASTER" 2>/dev/null; then
  echo "ERRO: kill -TERM falhou (tenta com sudo)." >&2
  exit 1
fi
for _ in $(seq 1 30); do
  if ! kill -0 "$MASTER" 2>/dev/null; then
    break
  fi
  sleep 1
done
if [[ -x "$VENV_GUNICORN" ]]; then
  echo "KPI: arranque gunicorn em $ROOT ..."
  cd "$ROOT"
  nohup "$VENV_GUNICORN" -w "$WORKERS" -b "$BIND" --timeout "$TIMEOUT" kpi_server:app >>/tmp/decide-kpi-gunicorn.log 2>&1 &
  disown || true
  sleep 3
else
  echo "ERRO: sem $VENV_GUNICORN não consigo re-arrancar; arranca manualmente." >&2
  exit 1
fi
echo "KPI: /api/health →"
health_curl
echo ""
exit 0
