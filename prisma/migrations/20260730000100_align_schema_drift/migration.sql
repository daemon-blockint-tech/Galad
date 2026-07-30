-- Aligns the database with prisma/schema.prisma so `prisma migrate diff` reports
-- clean and can therefore be used to detect real drift. The earlier migrations
-- hand-wrote constraint and index names that differ from the ones Prisma derives:
-- fusion_events_fusionId_fkey omitted ON UPDATE CASCADE, and four index names were
-- truncated at a different position than Prisma's 63-character truncation.
-- Every statement is guarded so this is safe on a database created by any of the
-- earlier migration sets, or by `prisma db push`.

ALTER TABLE "fusion_events" DROP CONSTRAINT IF EXISTS "fusion_events_fusionId_fkey";
ALTER TABLE "fusion_events" ADD CONSTRAINT "fusion_events_fusionId_fkey"
    FOREIGN KEY ("fusionId") REFERENCES "entity_fusions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE
    renames TEXT[][] := ARRAY[
        ['semantic_properties_tenantId_entityPluginId_entityId_propertyNa', 'semantic_properties_tenantId_entityPluginId_entityId_proper_key'],
        ['semantic_relationships_tenantId_sourcePluginId_sourceEntityId_i', 'semantic_relationships_tenantId_sourcePluginId_sourceEntity_idx'],
        ['semantic_relationships_tenantId_sourcePluginId_sourceEntityId_t', 'semantic_relationships_tenantId_sourcePluginId_sourceEntity_key'],
        ['semantic_relationships_tenantId_targetPluginId_targetEntityId_i', 'semantic_relationships_tenantId_targetPluginId_targetEntity_idx']
    ];
    pair TEXT[];
BEGIN
    FOREACH pair SLICE 1 IN ARRAY renames LOOP
        IF EXISTS (SELECT 1 FROM pg_class WHERE relname = pair[1] AND relkind = 'i')
           AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = pair[2] AND relkind = 'i') THEN
            EXECUTE format('ALTER INDEX %I RENAME TO %I', pair[1], pair[2]);
        END IF;
    END LOOP;
END $$;
