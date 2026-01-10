-- Make AuditEvent append-only: block UPDATE and DELETE at the database level.

CREATE OR REPLACE FUNCTION wadeherp_block_audit_mutations()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events_are_immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update ON "AuditEvent";
DROP TRIGGER IF EXISTS audit_events_no_delete ON "AuditEvent";

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION wadeherp_block_audit_mutations();

CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION wadeherp_block_audit_mutations();
