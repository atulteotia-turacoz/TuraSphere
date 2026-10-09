"""Compare the database with the SQLAlchemy models and add any missing columns.

`Base.metadata.create_all` (run at startup) creates missing *tables* but never
adds new *columns* to a table that already exists — so a server whose tables
were created by an older version of the code can be missing columns the code
now selects ("Unknown column 'advisory_boards.scheduled_date'").

Usage (from the backend folder, with the venv active):
    python check_schema.py            # report only — changes nothing
    python check_schema.py --apply    # add the missing columns

Only ADDs nullable-safe columns; never drops or alters anything.
"""
import sys

from sqlalchemy import inspect, text
from sqlalchemy.schema import CreateTable  # noqa: F401  (keeps dialect compilers loaded)

import app.models  # noqa: F401 - registers every model on Base.metadata
from app.core.database import Base, engine


def _default_sql(col, dialect) -> str:
    """DEFAULT clause for a NOT NULL column, so existing rows get a value."""
    d = col.default
    if d is None or not getattr(d, "is_scalar", False):
        return ""
    value = d.arg
    if hasattr(value, "value"):          # Python Enum member
        value = value.name if col.type.__class__.__name__ == "Enum" else value.value
    if isinstance(value, bool):
        return f" DEFAULT {1 if value else 0}"
    if isinstance(value, (int, float)):
        return f" DEFAULT {value}"
    return " DEFAULT '" + str(value).replace("'", "''") + "'"


def missing_columns():
    insp = inspect(engine)
    existing_tables = set(insp.get_table_names())
    out = []
    for table in Base.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue   # create_all makes whole missing tables at startup
        have = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name in have:
                continue
            col_type = col.type.compile(dialect=engine.dialect)
            default = _default_sql(col, engine.dialect)
            # NOT NULL without a usable default would fail on a table with rows.
            null = "NULL" if col.nullable or not default else "NOT NULL"
            out.append((table.name, col.name,
                        f"ALTER TABLE `{table.name}` ADD COLUMN `{col.name}` {col_type} {null}{default}"))
    return out


def main():
    apply = "--apply" in sys.argv
    todo = missing_columns()
    if not todo:
        print("Database matches the models — no missing columns.")
        return
    print(f"{len(todo)} missing column(s):")
    for table, column, sql in todo:
        print(f"  {table}.{column}\n      {sql};")
    if not apply:
        print("\nNothing changed. Run again with --apply to add them.")
        return
    with engine.begin() as conn:
        for table, column, sql in todo:
            conn.execute(text(sql))
            print(f"added {table}.{column}")
    print("Done. Restart the backend.")


if __name__ == "__main__":
    main()
