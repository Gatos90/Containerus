-- Clean up orphaned resource_acls when referenced resources are deleted.
-- The resource_acls table uses a polymorphic resource_type/resource_id pattern
-- without foreign key constraints, so we need triggers to prevent orphan rows.

CREATE OR REPLACE FUNCTION cleanup_resource_acls() RETURNS trigger AS $$
BEGIN
    DELETE FROM resource_acls
    WHERE resource_type = TG_ARGV[0]
      AND resource_id = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cleanup_system_acls
    BEFORE DELETE ON systems
    FOR EACH ROW EXECUTE FUNCTION cleanup_resource_acls('system');

CREATE TRIGGER trg_cleanup_cluster_acls
    BEFORE DELETE ON clusters
    FOR EACH ROW EXECUTE FUNCTION cleanup_resource_acls('cluster');

CREATE TRIGGER trg_cleanup_environment_acls
    BEFORE DELETE ON environments
    FOR EACH ROW EXECUTE FUNCTION cleanup_resource_acls('environment');
