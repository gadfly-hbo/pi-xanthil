import importlib.util
import pathlib
import tempfile
import unittest


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "duckdb_aggregate.py"
spec = importlib.util.spec_from_file_location("duckdb_aggregate", MODULE_PATH)
duckdb_aggregate = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(duckdb_aggregate)


class DuckDbAggregateSecurityTest(unittest.TestCase):
    def test_normalize_sql_rejects_file_table_functions(self):
        with self.assertRaisesRegex(ValueError, "禁止关键字"):
            duckdb_aggregate.normalize_sql(
                "SELECT count(*) FROM read_csv_auto('/tmp/secret_outside.csv')"
            )

    def test_external_access_disabled_after_input_materialization(self):
        duckdb = duckdb_aggregate.import_duckdb()
        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = pathlib.Path(tmpdir)
            input_csv = tmp / "allowed.csv"
            outside_csv = tmp / "secret_outside.csv"
            input_csv.write_text("region,amount\nA,10\n", encoding="utf-8")
            outside_csv.write_text("name,salary\nalice,999\n", encoding="utf-8")

            con = duckdb.connect(database=":memory:")
            try:
                duckdb_aggregate.materialize_input_data(con, [str(input_csv)])
                duckdb_aggregate.disable_external_access(con)

                self.assertEqual(
                    con.execute("SELECT SUM(amount) FROM input_data").fetchone()[0],
                    10,
                )
                with self.assertRaises(Exception):
                    con.execute(f"SELECT * FROM read_csv_auto('{outside_csv}')").fetchall()
            finally:
                con.close()


if __name__ == "__main__":
    unittest.main()
