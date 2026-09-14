const ID = /(["'])(evt|env)_[0-9a-f]{12}\1/g;
const TS = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00/g;
const SESSION_SUFFIX = /sssf-([0-9a-f]{8})-([A-Za-z0-9_]+)-[0-9a-f]{4}/g;
const DURATION = /\b\d+\.\d+s\b/g;
const DURATION_MS = /"duration_ms": \d+/g;
const PID = /"pid": \d+/g;
const COST = /\$\d+\.\d{4}/g;
const UV_INSTALL = /^Installed \d+ packages in \d+ms\n*/gm;

const PYDANTIC_URL = /https:\/\/errors\.pydantic\.dev\/\d+\.\d+\/v\//g;

export function normalizeText(s: string): string {
  return s
    .replace(UV_INSTALL, "")
    .replace(/adws\/adw_modules\/quality\.py/g, "adws/adw_modules/quality.ts")
    .replace(/adw_\*\.py/g, "adw_*.ts")
    .replace(/\b(adw_[a-z0-9_]+)\.py\b/g, "$1.ts")
    .replace(/uv run adws\//g, "bun adws/")
    .replace(TS, "<TS>")
    .replace(SESSION_SUFFIX, "sssf-$1-$2-<HEX4>")
    .replace(ID, "$1$2_<ID>$1")
    .replace(DURATION_MS, '"duration_ms": 0')
    .replace(DURATION, "<DUR>s")
    .replace(PID, '"pid": 0')
    .replace(/INSERT INTO processes VALUES\((\d+),('(?:[^']|'')*'),('(?:[^']|'')*'),('(?:[^']|'')*'),(\d+)/g, "INSERT INTO processes VALUES($1,$2,$3,$4,0")
    .replace(COST, "$<COST>")
    .replace(PYDANTIC_URL, "https://errors.pydantic.dev/<VER>/v/");
}

export function normalizeSqliteDump(dump: string): string {
  return normalizeText(dump)
    .replace(/INSERT INTO processes[^;]+;/g, (row) => row.replace(/\d+/g, (n) => (n.length > 4 ? n : n)));
}
