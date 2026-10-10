#!/usr/bin/env bash
# ============================================================================
# 使い捨ての PostgreSQL コンテナで、supabase/migrations（0001〜）と tests/sql/cases を検証する。
#
#   npm run test:sql            # new と legacy の両モード
#   npm run test:sql -- new     # どちらか一方だけ
#
# モード：
#   new    … 新規オブジェクトに権限を自動付与しない（Staging 相当）
#   legacy … anon / authenticated / service_role へ ALL を自動付与する旧挙動（本番相当）
#
# 安全策：
#   - コンテナは --network none で起動し、ホストにポートを公開しない（外部へも接続できない）
#   - SQL は docker exec の psql（コンテナ内のローカル接続）だけで実行する
#   - 接続文字列や Supabase の環境変数は一切読まない
#   - 正常終了・エラー・中断のいずれでもコンテナを削除する
# ============================================================================
set -euo pipefail

# 本番・Staging と同じメジャーバージョンに固定する（Supabase Dashboard で確認した値）。
# 未確定のまま実行しないよう、空の間はエラーで止める。
POSTGRES_IMAGE="postgres:17.11-bookworm"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
SQL_DIR="$ROOT/tests/sql"

if [[ -z "$POSTGRES_IMAGE" ]]; then
  echo "エラー: scripts/test-sql.sh の POSTGRES_IMAGE が未設定です。" >&2
  echo "本番・Staging の PostgreSQL のメジャーバージョンを確認し、タグを固定してから実行してください。" >&2
  exit 2
fi

if [[ $# -gt 0 ]]; then
  MODES=("$@")
else
  MODES=(new legacy)
fi
for mode in "${MODES[@]}"; do
  if [[ "$mode" != "new" && "$mode" != "legacy" ]]; then
    echo "エラー: 不明なモード '$mode'（new / legacy のみ）" >&2
    exit 2
  fi
done

CONTAINERS=()
cleanup() {
  for name in "${CONTAINERS[@]}"; do
    docker rm -f "$name" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT INT TERM

# コンテナ内の psql で SQL ファイルを1トランザクションとして実行する。
run_sql_file() {
  local name="$1" file="$2"
  docker exec -i "$name" psql -X -q -v ON_ERROR_STOP=1 --single-transaction -U postgres -d postgres -f - < "$file"
}

run_sql_command() {
  local name="$1" sql="$2"
  docker exec "$name" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres -c "$sql"
}

declare -A RESULTS=()

for mode in "${MODES[@]}"; do
  name="genba-sqltest-${mode}-$$-${RANDOM}"
  log="$(mktemp)"
  echo "════════ ${mode} モード（${POSTGRES_IMAGE}） ════════"

  docker run -d --rm --name "$name" --network none \
    -e POSTGRES_HOST_AUTH_METHOD=trust \
    --label genba-photo-sqltest=1 \
    "$POSTGRES_IMAGE" >/dev/null
  CONTAINERS+=("$name")

  # 初期化用の一時サーバーは TCP を待ち受けないため、127.0.0.1 で応答したら本起動とみなす。
  for _ in $(seq 1 60); do
    if docker exec "$name" pg_isready -q -h 127.0.0.1 -U postgres; then
      break
    fi
    sleep 1
  done
  docker exec "$name" pg_isready -q -h 127.0.0.1 -U postgres

  status="PASS"
  {
    echo "-- PostgreSQL: $(docker exec "$name" psql -X -At -U postgres -d postgres -c 'show server_version')"
    echo "-- bootstrap.sql"
    run_sql_file "$name" "$SQL_DIR/bootstrap.sql"
    if [[ "$mode" == "legacy" ]]; then
      echo "-- grants-legacy.sql"
      run_sql_file "$name" "$SQL_DIR/grants-legacy.sql"
    fi
    for migration in "$MIGRATIONS_DIR"/[0-9][0-9][0-9][0-9]_*.sql; do
      echo "-- migration: $(basename "$migration")"
      run_sql_file "$name" "$migration"
    done
    run_sql_command "$name" "alter database postgres set test.mode = '${mode}'"
    echo "-- helpers.sql"
    run_sql_file "$name" "$SQL_DIR/helpers.sql"
    for case_file in "$SQL_DIR"/cases/*.sql; do
      echo "-- case: $(basename "$case_file")"
      run_sql_file "$name" "$case_file"
    done
  } > >(tee "$log") 2>&1 || status="FAIL"
  wait

  passed="$(grep -c 'NOTICE:  ok:' "$log" || true)"
  RESULTS[$mode]="${status}（ok ${passed} 件）"
  echo "──────── ${mode}: ${RESULTS[$mode]}"

  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -f "$log"
done

echo
echo "════════ 結果 ════════"
exit_code=0
for mode in "${MODES[@]}"; do
  echo "${mode}: ${RESULTS[$mode]}"
  [[ "${RESULTS[$mode]}" == PASS* ]] || exit_code=1
done
exit "$exit_code"
