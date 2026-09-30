#!/bin/sh
# Проверка schema.sql на локальном PostgreSQL (нужен psql и сервер; по умолчанию порт 5432).
# Пример: PGHOST=/tmp PGPORT=55432 PGUSER=postgres sh supabase/tests/run.sh
set -e
cd "$(dirname "$0")"
psql -q -c "drop database if exists bnr_test" -c "create database bnr_test"
psql -q -d bnr_test -f stub.sql >/dev/null 2>&1
psql -q -d bnr_test -v ON_ERROR_STOP=1 -f ../schema.sql >/dev/null 2>&1
out=$(psql -d bnr_test -f rls_test.sql 2>&1 | grep -oE "(OK|FAIL|ERROR).*")
echo "$out"
echo "$out" | grep -q -E "^(FAIL|ERROR)" && { echo "ЕСТЬ ОШИБКИ"; exit 1; } || echo "Все проверки прошли"
