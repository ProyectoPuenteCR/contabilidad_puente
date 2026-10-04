import { randomUUID } from 'crypto';
import { neon } from '@neondatabase/serverless';

let sqlClient = null;

export function isCloudDatabaseConfigured() {
  return Boolean(String(process.env.DATABASE_URL || '').trim());
}

export function getCloudSql() {
  if (!isCloudDatabaseConfigured()) {
    throw new Error('DATABASE_NOT_CONFIGURED');
  }

  if (!sqlClient) {
    sqlClient = neon(process.env.DATABASE_URL);
  }

  return sqlClient;
}

export async function ensureCloudSchema() {
  const sql = getCloudSql();

  await sql`
    CREATE TABLE IF NOT EXISTS cloud_state (
      id integer PRIMARY KEY,
      revision bigint NOT NULL DEFAULT 0,
      active boolean NOT NULL DEFAULT false,
      migrated_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      updated_by text
    )
  `;

  await sql`
    INSERT INTO cloud_state (id, revision, active)
    VALUES (1, 0, false)
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS ledger_entries (
      id text PRIMARY KEY,
      movement_date date,
      account text NOT NULL DEFAULT '',
      folder text NOT NULL DEFAULT '',
      concept text NOT NULL DEFAULT '',
      detail text NOT NULL DEFAULT '',
      operation text NOT NULL DEFAULT '',
      income numeric(18,2) NOT NULL DEFAULT 0,
      expense numeric(18,2) NOT NULL DEFAULT 0,
      invoice text NOT NULL DEFAULT '',
      notes text NOT NULL DEFAULT '',
      created_by text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ledger_date
    ON ledger_entries (movement_date DESC)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ledger_account
    ON ledger_entries (account)
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_ledger_concept
    ON ledger_entries (concept)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS time_entries (
      id text PRIMARY KEY,
      entry_date date,
      specialist text NOT NULL DEFAULT '',
      service text NOT NULL DEFAULT '',
      hours numeric(12,2) NOT NULL DEFAULT 0,
      hourly_rate numeric(18,2) NOT NULL DEFAULT 0,
      notes text NOT NULL DEFAULT '',
      created_by text,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS investments (
      id text PRIMARY KEY,
      name text NOT NULL DEFAULT '',
      investment_type text NOT NULL DEFAULT '',
      bank text NOT NULL DEFAULT '',
      principal numeric(18,2) NOT NULL DEFAULT 0,
      interest numeric(18,2) NOT NULL DEFAULT 0,
      reimbursement numeric(18,2) NOT NULL DEFAULT 0,
      maturity_date date,
      status text NOT NULL DEFAULT '',
      notes text NOT NULL DEFAULT '',
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS institutions (
      id text PRIMARY KEY,
      name text NOT NULL,
      institution_type text NOT NULL DEFAULT 'Otro',
      active boolean NOT NULL DEFAULT true,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_institutions_name
    ON institutions (upper(name))
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS concepts (
      name text PRIMARY KEY,
      active boolean NOT NULL DEFAULT true,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS saldo_snapshot (
      id integer PRIMARY KEY,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      updated_by text,
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS accounting_audit_log (
      id text PRIMARY KEY,
      event_at timestamptz NOT NULL DEFAULT now(),
      action text NOT NULL DEFAULT '',
      user_name text NOT NULL DEFAULT '',
      user_email text NOT NULL DEFAULT '',
      reason text NOT NULL DEFAULT '',
      payload jsonb NOT NULL DEFAULT '{}'::jsonb
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_accounting_audit_event_at
    ON accounting_audit_log (event_at DESC)
  `;
}

function textValue(value) {
  return String(value ?? '').trim();
}

function amount(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeMovements(rows, actor) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: textValue(row?.id) || randomUUID(),
    date: textValue(row?.date),
    account: textValue(row?.account),
    folder: textValue(row?.folder),
    concept: textValue(row?.concept),
    detail: textValue(row?.detail),
    operation: textValue(row?.operation),
    income: amount(row?.income),
    expense: amount(row?.expense),
    invoice: textValue(row?.invoice),
    notes: textValue(row?.notes),
    actor,
  }));
}

function normalizeHours(rows, actor) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: textValue(row?.id) || randomUUID(),
    date: textValue(row?.date),
    specialist: textValue(row?.specialist),
    service: textValue(row?.service),
    hours: amount(row?.hours),
    hourlyRate: amount(row?.hourlyRate),
    notes: textValue(row?.notes),
    actor,
  }));
}

function normalizeInvestments(rows, actor) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: textValue(row?.id) || randomUUID(),
    name: textValue(row?.name),
    type: textValue(row?.type),
    bank: textValue(row?.bank),
    principal: amount(row?.principal),
    interest: amount(row?.interest),
    reimbursement: amount(row?.reimbursement),
    maturityDate: textValue(row?.maturityDate),
    status: textValue(row?.status),
    notes: textValue(row?.notes),
    actor,
  }));
}

function normalizeInstitutions(rows, actor) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: textValue(row?.id) || randomUUID(),
    name: textValue(row?.name),
    type: textValue(row?.type) || 'Otro',
    active: row?.active !== false,
    actor,
  })).filter((row) => row.name);
}

function normalizeConcepts(rows, actor) {
  return [...new Set(
    (Array.isArray(rows) ? rows : [])
      .map((value) => textValue(value))
      .filter(Boolean)
  )].map((name) => ({ name, actor }));
}

function normalizeAudit(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: textValue(row?.id) || randomUUID(),
    at: textValue(row?.at) || new Date().toISOString(),
    action: textValue(row?.action),
    userName: textValue(row?.userName),
    userEmail: textValue(row?.userEmail),
    reason: textValue(row?.reason),
    payload: row && typeof row === 'object' ? row : {},
  }));
}

export function normalizeCloudSnapshot(snapshot, actor = '') {
  return {
    movements: normalizeMovements(snapshot?.movements, actor),
    hours: normalizeHours(snapshot?.hours, actor),
    investments: normalizeInvestments(snapshot?.investments, actor),
    institutions: normalizeInstitutions(snapshot?.institutions, actor),
    concepts: normalizeConcepts(snapshot?.concepts, actor),
    saldoSnapshot:
      snapshot?.saldoSnapshot && typeof snapshot.saldoSnapshot === 'object'
        ? snapshot.saldoSnapshot
        : {},
    auditLog: normalizeAudit(snapshot?.auditLog),
  };
}

export function summarizeMovements(rows) {
  return (Array.isArray(rows) ? rows : []).reduce(
    (acc, row) => {
      acc.count += 1;
      acc.income += amount(row?.income);
      acc.expense += amount(row?.expense);
      return acc;
    },
    { count: 0, income: 0, expense: 0 }
  );
}

export async function getCloudStatus() {
  if (!isCloudDatabaseConfigured()) {
    return {
      configured: false,
      connected: false,
      active: false,
      revision: 0,
      ledger: { count: 0, income: 0, expense: 0, result: 0 },
      databaseBytes: 0,
      databaseMb: 0,
    };
  }

  await ensureCloudSchema();
  const sql = getCloudSql();

  const [stateRows, ledgerRows, sizeRows] = await Promise.all([
    sql`
      SELECT revision, active, migrated_at, updated_at, updated_by
      FROM cloud_state
      WHERE id = 1
    `,
    sql`
      SELECT
        count(*)::bigint AS count,
        COALESCE(sum(income),0)::numeric AS income,
        COALESCE(sum(expense),0)::numeric AS expense
      FROM ledger_entries
    `,
    sql`
      SELECT pg_database_size(current_database())::bigint AS bytes
    `,
  ]);

  const state = stateRows?.[0] || {};
  const ledger = ledgerRows?.[0] || {};
  const bytes = Number(sizeRows?.[0]?.bytes || 0);
  const income = Number(ledger.income || 0);
  const expense = Number(ledger.expense || 0);

  return {
    configured: true,
    connected: true,
    active: Boolean(state.active),
    revision: Number(state.revision || 0),
    migratedAt: state.migrated_at || null,
    updatedAt: state.updated_at || null,
    updatedBy: state.updated_by || '',
    ledger: {
      count: Number(ledger.count || 0),
      income,
      expense,
      result: income - expense,
    },
    databaseBytes: bytes,
    databaseMb: bytes / 1024 / 1024,
  };
}

export async function readCloudSnapshot() {
  await ensureCloudSchema();
  const sql = getCloudSql();

  const [
    stateRows,
    movementRows,
    hourRows,
    investmentRows,
    institutionRows,
    conceptRows,
    saldoRows,
    auditRows,
  ] = await Promise.all([
    sql`SELECT revision, active, migrated_at, updated_at, updated_by FROM cloud_state WHERE id = 1`,
    sql`
      SELECT
        id,
        to_char(movement_date, 'YYYY-MM-DD') AS date,
        account,
        folder,
        concept,
        detail,
        operation,
        income,
        expense,
        invoice,
        notes
      FROM ledger_entries
      ORDER BY movement_date DESC NULLS LAST, updated_at DESC
    `,
    sql`
      SELECT
        id,
        to_char(entry_date, 'YYYY-MM-DD') AS date,
        specialist,
        service,
        hours,
        hourly_rate,
        notes
      FROM time_entries
      ORDER BY entry_date DESC NULLS LAST
    `,
    sql`
      SELECT
        id,
        name,
        investment_type,
        bank,
        principal,
        interest,
        reimbursement,
        to_char(maturity_date, 'YYYY-MM-DD') AS maturity_date,
        status,
        notes
      FROM investments
      ORDER BY maturity_date NULLS LAST, name
    `,
    sql`
      SELECT id, name, institution_type, active
      FROM institutions
      ORDER BY name
    `,
    sql`
      SELECT name
      FROM concepts
      WHERE active = true
      ORDER BY name
    `,
    sql`
      SELECT payload
      FROM saldo_snapshot
      WHERE id = 1
    `,
    sql`
      SELECT
        id,
        event_at,
        action,
        user_name,
        user_email,
        reason,
        payload
      FROM accounting_audit_log
      ORDER BY event_at DESC
      LIMIT 2000
    `,
  ]);

  const state = stateRows?.[0] || {};

  return {
    active: Boolean(state.active),
    revision: Number(state.revision || 0),
    migratedAt: state.migrated_at || null,
    updatedAt: state.updated_at || null,
    updatedBy: state.updated_by || '',
    movements: (movementRows || []).map((row) => ({
      id: row.id,
      date: row.date || '',
      account: row.account || '',
      folder: row.folder || '',
      concept: row.concept || '',
      detail: row.detail || '',
      operation: row.operation || '',
      income: Number(row.income || 0),
      expense: Number(row.expense || 0),
      invoice: row.invoice || '',
      notes: row.notes || '',
    })),
    hours: (hourRows || []).map((row) => ({
      id: row.id,
      date: row.date || '',
      specialist: row.specialist || '',
      service: row.service || '',
      hours: Number(row.hours || 0),
      hourlyRate: Number(row.hourly_rate || 0),
      notes: row.notes || '',
    })),
    investments: (investmentRows || []).map((row) => ({
      id: row.id,
      name: row.name || '',
      type: row.investment_type || '',
      bank: row.bank || '',
      principal: Number(row.principal || 0),
      interest: Number(row.interest || 0),
      reimbursement: Number(row.reimbursement || 0),
      maturityDate: row.maturity_date || '',
      status: row.status || '',
      notes: row.notes || '',
    })),
    institutions: (institutionRows || []).map((row) => ({
      id: row.id,
      name: row.name || '',
      type: row.institution_type || 'Otro',
      active: row.active !== false,
    })),
    concepts: (conceptRows || []).map((row) => row.name).filter(Boolean),
    saldoSnapshot: saldoRows?.[0]?.payload || {},
    auditLog: (auditRows || []).map((row) => ({
      ...(row.payload && typeof row.payload === 'object' ? row.payload : {}),
      id: row.id,
      at: row.event_at || row.payload?.at || '',
      action: row.action || row.payload?.action || '',
      userName: row.user_name || row.payload?.userName || '',
      userEmail: row.user_email || row.payload?.userEmail || '',
      reason: row.reason || row.payload?.reason || '',
    })),
  };
}

export async function writeCloudSnapshot({
  snapshot,
  actor,
  baseRevision,
  activate = false,
}) {
  await ensureCloudSchema();
  const sql = getCloudSql();
  const normalized = normalizeCloudSnapshot(snapshot, actor);

  const movementsJson = JSON.stringify(normalized.movements);
  const hoursJson = JSON.stringify(normalized.hours);
  const investmentsJson = JSON.stringify(normalized.investments);
  const institutionsJson = JSON.stringify(normalized.institutions);
  const conceptsJson = JSON.stringify(normalized.concepts);
  const auditJson = JSON.stringify(normalized.auditLog);
  const saldoJson = JSON.stringify(normalized.saldoSnapshot || {});
  const expectedRevision = Number(baseRevision || 0);

  const rows = await sql`
    WITH guard AS (
      UPDATE cloud_state
      SET
        revision = revision + 1,
        active = CASE WHEN ${activate} THEN true ELSE active END,
        migrated_at = CASE
          WHEN ${activate} AND migrated_at IS NULL THEN now()
          ELSE migrated_at
        END,
        updated_at = now(),
        updated_by = ${actor}
      WHERE id = 1 AND revision = ${expectedRevision}
      RETURNING revision
    ),

    upsert_ledger AS (
      INSERT INTO ledger_entries (
        id, movement_date, account, folder, concept, detail, operation,
        income, expense, invoice, notes,
        created_by, updated_by, updated_at
      )
      SELECT
        x.id,
        NULLIF(x.date, '')::date,
        x.account,
        x.folder,
        x.concept,
        x.detail,
        x.operation,
        x.income::numeric(18,2),
        x.expense::numeric(18,2),
        x.invoice,
        x.notes,
        x.actor,
        x.actor,
        now()
      FROM jsonb_to_recordset(${movementsJson}::jsonb) AS x(
        id text,
        date text,
        account text,
        folder text,
        concept text,
        detail text,
        operation text,
        income double precision,
        expense double precision,
        invoice text,
        notes text,
        actor text
      )
      WHERE EXISTS (SELECT 1 FROM guard)
      ON CONFLICT (id) DO UPDATE SET
        movement_date = EXCLUDED.movement_date,
        account = EXCLUDED.account,
        folder = EXCLUDED.folder,
        concept = EXCLUDED.concept,
        detail = EXCLUDED.detail,
        operation = EXCLUDED.operation,
        income = EXCLUDED.income,
        expense = EXCLUDED.expense,
        invoice = EXCLUDED.invoice,
        notes = EXCLUDED.notes,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      RETURNING id
    ),

    delete_ledger AS (
      DELETE FROM ledger_entries
      WHERE EXISTS (SELECT 1 FROM guard)
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(${movementsJson}::jsonb) AS x(id text)
          WHERE x.id = ledger_entries.id
        )
      RETURNING id
    ),

    upsert_hours AS (
      INSERT INTO time_entries (
        id, entry_date, specialist, service, hours, hourly_rate, notes,
        created_by, updated_by, updated_at
      )
      SELECT
        x.id,
        NULLIF(x.date, '')::date,
        x.specialist,
        x.service,
        x.hours::numeric(12,2),
        x.hourly_rate::numeric(18,2),
        x.notes,
        x.actor,
        x.actor,
        now()
      FROM jsonb_to_recordset(${hoursJson}::jsonb) AS x(
        id text,
        date text,
        specialist text,
        service text,
        hours double precision,
        hourly_rate double precision,
        notes text,
        actor text
      )
      WHERE EXISTS (SELECT 1 FROM guard)
      ON CONFLICT (id) DO UPDATE SET
        entry_date = EXCLUDED.entry_date,
        specialist = EXCLUDED.specialist,
        service = EXCLUDED.service,
        hours = EXCLUDED.hours,
        hourly_rate = EXCLUDED.hourly_rate,
        notes = EXCLUDED.notes,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      RETURNING id
    ),

    delete_hours AS (
      DELETE FROM time_entries
      WHERE EXISTS (SELECT 1 FROM guard)
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(${hoursJson}::jsonb) AS x(id text)
          WHERE x.id = time_entries.id
        )
      RETURNING id
    ),

    upsert_investments AS (
      INSERT INTO investments (
        id, name, investment_type, bank, principal, interest, reimbursement,
        maturity_date, status, notes, updated_by, updated_at
      )
      SELECT
        x.id,
        x.name,
        x.type,
        x.bank,
        x.principal::numeric(18,2),
        x.interest::numeric(18,2),
        x.reimbursement::numeric(18,2),
        NULLIF(x.maturity_date, '')::date,
        x.status,
        x.notes,
        x.actor,
        now()
      FROM jsonb_to_recordset(${investmentsJson}::jsonb) AS x(
        id text,
        name text,
        type text,
        bank text,
        principal double precision,
        interest double precision,
        reimbursement double precision,
        maturity_date text,
        status text,
        notes text,
        actor text
      )
      WHERE EXISTS (SELECT 1 FROM guard)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        investment_type = EXCLUDED.investment_type,
        bank = EXCLUDED.bank,
        principal = EXCLUDED.principal,
        interest = EXCLUDED.interest,
        reimbursement = EXCLUDED.reimbursement,
        maturity_date = EXCLUDED.maturity_date,
        status = EXCLUDED.status,
        notes = EXCLUDED.notes,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      RETURNING id
    ),

    delete_investments AS (
      DELETE FROM investments
      WHERE EXISTS (SELECT 1 FROM guard)
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(${investmentsJson}::jsonb) AS x(id text)
          WHERE x.id = investments.id
        )
      RETURNING id
    ),

    upsert_institutions AS (
      INSERT INTO institutions (
        id, name, institution_type, active, updated_by, updated_at
      )
      SELECT
        x.id,
        x.name,
        x.type,
        x.active,
        x.actor,
        now()
      FROM jsonb_to_recordset(${institutionsJson}::jsonb) AS x(
        id text,
        name text,
        type text,
        active boolean,
        actor text
      )
      WHERE EXISTS (SELECT 1 FROM guard)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        institution_type = EXCLUDED.institution_type,
        active = EXCLUDED.active,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      RETURNING id
    ),

    delete_institutions AS (
      DELETE FROM institutions
      WHERE EXISTS (SELECT 1 FROM guard)
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(${institutionsJson}::jsonb) AS x(id text)
          WHERE x.id = institutions.id
        )
      RETURNING id
    ),

    upsert_concepts AS (
      INSERT INTO concepts (name, active, updated_by, updated_at)
      SELECT x.name, true, x.actor, now()
      FROM jsonb_to_recordset(${conceptsJson}::jsonb) AS x(
        name text,
        actor text
      )
      WHERE EXISTS (SELECT 1 FROM guard)
      ON CONFLICT (name) DO UPDATE SET
        active = true,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      RETURNING name
    ),

    delete_concepts AS (
      DELETE FROM concepts
      WHERE EXISTS (SELECT 1 FROM guard)
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(${conceptsJson}::jsonb) AS x(name text)
          WHERE x.name = concepts.name
        )
      RETURNING name
    ),

    upsert_saldo AS (
      INSERT INTO saldo_snapshot (id, payload, updated_by, updated_at)
      SELECT 1, ${saldoJson}::jsonb, ${actor}, now()
      WHERE EXISTS (SELECT 1 FROM guard)
      ON CONFLICT (id) DO UPDATE SET
        payload = EXCLUDED.payload,
        updated_by = EXCLUDED.updated_by,
        updated_at = now()
      RETURNING id
    ),

    upsert_audit AS (
      INSERT INTO accounting_audit_log (
        id, event_at, action, user_name, user_email, reason, payload
      )
      SELECT
        x.id,
        COALESCE(NULLIF(x.at, '')::timestamptz, now()),
        x.action,
        x.user_name,
        x.user_email,
        x.reason,
        x.payload
      FROM jsonb_to_recordset(${auditJson}::jsonb) AS x(
        id text,
        at text,
        action text,
        user_name text,
        user_email text,
        reason text,
        payload jsonb
      )
      WHERE EXISTS (SELECT 1 FROM guard)
      ON CONFLICT (id) DO UPDATE SET
        event_at = EXCLUDED.event_at,
        action = EXCLUDED.action,
        user_name = EXCLUDED.user_name,
        user_email = EXCLUDED.user_email,
        reason = EXCLUDED.reason,
        payload = EXCLUDED.payload
      RETURNING id
    ),

    delete_audit AS (
      DELETE FROM accounting_audit_log
      WHERE EXISTS (SELECT 1 FROM guard)
        AND NOT EXISTS (
          SELECT 1
          FROM jsonb_to_recordset(${auditJson}::jsonb) AS x(id text)
          WHERE x.id = accounting_audit_log.id
        )
      RETURNING id
    )

    SELECT revision
    FROM guard
  `;

  if (!rows?.length) {
    const error = new Error('REVISION_CONFLICT');
    error.code = 'REVISION_CONFLICT';
    throw error;
  }

  return {
    revision: Number(rows[0].revision || 0),
    summary: summarizeMovements(normalized.movements),
    normalized,
  };
}
