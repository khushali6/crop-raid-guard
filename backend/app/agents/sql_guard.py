"""Validation for model-written SQL.

Defence in depth: (1) parse with sqlglot and allow only a single SELECT over allow-listed views,
(2) reject dangerous functions, (3) force a LIMIT, then (4) execute in a READ ONLY transaction as the
`authenticated` role with the caller's claims (RLS) and a statement timeout.
"""

from __future__ import annotations

import sqlglot
from sqlglot import exp

ALLOWED_TABLES = {"agent_events", "agent_farms", "agent_videos"}
DENIED_FUNCTIONS = {
    "pg_sleep", "set_config", "current_setting", "dblink", "lo_import", "lo_export", "pg_read_file",
    "pg_read_binary_file", "pg_ls_dir", "pg_stat_file", "query_to_xml", "copy", "pg_terminate_backend",
    "pg_cancel_backend", "txid_current", "nextval", "setval", "pg_advisory_lock", "gen_random_uuid",
}
MAX_LIMIT = 200


class UnsafeSQL(ValueError):
    pass


def validate_sql(sql: str) -> str:
    sql = (sql or "").strip().rstrip(";").strip()
    if not sql:
        raise UnsafeSQL("empty query")
    try:
        statements = sqlglot.parse(sql, read="postgres")
    except sqlglot.errors.ParseError as exc:
        raise UnsafeSQL(f"could not parse SQL: {exc}") from exc
    if len(statements) != 1 or statements[0] is None:
        raise UnsafeSQL("only a single statement is allowed")
    tree = statements[0]
    if not isinstance(tree, (exp.Select, exp.Union, exp.Intersect, exp.Except)):
        raise UnsafeSQL("only SELECT queries are allowed")
    for node in tree.walk():
        if isinstance(node, (exp.Insert, exp.Update, exp.Delete, exp.Drop, exp.Create, exp.Alter, exp.Command,
                             exp.Into, exp.Merge, exp.TruncateTable, exp.Grant)):
            raise UnsafeSQL(f"{node.key.upper()} is not allowed")
        if isinstance(node, exp.Lock):
            raise UnsafeSQL("locking clauses are not allowed")

    cte_names = {cte.alias_or_name.lower() for cte in tree.find_all(exp.CTE)}
    for table in tree.find_all(exp.Table):
        name = table.name.lower()
        schema = (table.db or "").lower()
        if name in cte_names and not schema:
            continue
        if schema not in ("", "public") or name not in ALLOWED_TABLES:
            raise UnsafeSQL(f"table '{table.sql()}' is not allowed; use {', '.join(sorted(ALLOWED_TABLES))}")

    for func in tree.find_all(exp.Func):
        fname = (func.sql_name() if not isinstance(func, exp.Anonymous) else func.name).lower()
        if fname in DENIED_FUNCTIONS or fname.startswith("pg_"):
            raise UnsafeSQL(f"function '{fname}' is not allowed")

    limit = tree.args.get("limit")
    if limit is None:
        tree = tree.limit(MAX_LIMIT)
    else:
        try:
            value = int(limit.expression.this)
        except (AttributeError, TypeError, ValueError):
            value = MAX_LIMIT + 1
        if value > MAX_LIMIT:
            tree = tree.limit(MAX_LIMIT)
    return tree.sql(dialect="postgres")
