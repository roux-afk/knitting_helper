CREATE TABLE import_batches (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES profiles,
 source_name text NOT NULL, source_hash text NOT NULL, preview jsonb NOT NULL,
 status text NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','committed')),
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), committed_at timestamptz,
 UNIQUE(owner_id,id), UNIQUE(owner_id,source_hash)
);
CREATE TABLE import_items (
 owner_id uuid NOT NULL REFERENCES profiles, batch_id uuid NOT NULL, row_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('template','purchase','project')),
 target_id uuid NOT NULL, data jsonb NOT NULL,
 PRIMARY KEY(owner_id,batch_id,row_key),
 FOREIGN KEY(owner_id,batch_id) REFERENCES import_batches(owner_id,id)
);
ALTER TABLE templates ADD COLUMN source_data jsonb;
ALTER TABLE projects ADD COLUMN source_data jsonb;
ALTER TABLE projects ADD COLUMN end_month text CHECK(end_month ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE projects ADD COLUMN legacy_material_cost numeric(14,2) CHECK(legacy_material_cost>=0);
ALTER TABLE yarns ADD COLUMN personal_code text;
ALTER TABLE yarns ADD COLUMN needs_inventory boolean NOT NULL DEFAULT false;
