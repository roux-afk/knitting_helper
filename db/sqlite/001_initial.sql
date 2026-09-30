CREATE TABLE profiles (
 id TEXT PRIMARY KEY, hourly_rate INTEGER NOT NULL DEFAULT 12500 CHECK(hourly_rate>=0),
 timezone text NOT NULL DEFAULT 'Europe/Moscow'
) STRICT;
INSERT INTO profiles(id) VALUES('00000000-0000-4000-8000-000000000001');

CREATE TABLE templates (
 id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()), owner_id TEXT NOT NULL REFERENCES profiles(id),
 title text NOT NULL, category text NOT NULL, notes text NOT NULL DEFAULT '',
 rate INTEGER NOT NULL DEFAULT 12500, price INTEGER, created_at TEXT NOT NULL DEFAULT (now()),
 UNIQUE(owner_id,id)
) STRICT;
CREATE TABLE projects (
 id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()), owner_id TEXT NOT NULL REFERENCES profiles(id),
 template_id TEXT, title text NOT NULL, category text NOT NULL, notes text NOT NULL DEFAULT '',
 quantity integer NOT NULL DEFAULT 1 CHECK(quantity>0), purpose text NOT NULL CHECK(purpose IN ('self','gift','sale')),
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','paused','completed','cancelled')),
 start_date TEXT, end_date TEXT, rate INTEGER NOT NULL CHECK(rate>=0),
 price INTEGER CHECK(price>=0), other_cost INTEGER NOT NULL DEFAULT 0 CHECK(other_cost>=0),
 historical INTEGER NOT NULL DEFAULT false, archived INTEGER NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (now()),
 UNIQUE(owner_id,id), FOREIGN KEY(owner_id,template_id) REFERENCES templates(owner_id,id),
 CHECK(end_date IS NULL OR start_date IS NULL OR end_date>=start_date)
) STRICT;
CREATE TABLE yarns (
 id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()), owner_id TEXT NOT NULL REFERENCES profiles(id),
 manufacturer text NOT NULL, name text NOT NULL, color text NOT NULL, color_hex text NOT NULL DEFAULT '#9987ad',
 composition text NOT NULL, skein_weight INTEGER NOT NULL CHECK(skein_weight>0),
 skein_length INTEGER CHECK(skein_length>0), created_at TEXT NOT NULL DEFAULT (now()), UNIQUE(owner_id,id)
) STRICT;
CREATE TABLE receipts (
 id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()), owner_id TEXT NOT NULL REFERENCES profiles(id),
 yarn_id TEXT NOT NULL, grams INTEGER NOT NULL CHECK(grams>0), cost INTEGER CHECK(cost>=0),
 skein_weight INTEGER NOT NULL CHECK(skein_weight>0), skein_length INTEGER,
 dye_lot text NOT NULL DEFAULT '', purchased_on TEXT NOT NULL, note text NOT NULL DEFAULT '',
 created_at TEXT NOT NULL DEFAULT (now()), UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,yarn_id) REFERENCES yarns(owner_id,id)
) STRICT;
CREATE TABLE movements (
 id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()), owner_id TEXT NOT NULL REFERENCES profiles(id),
 receipt_id TEXT NOT NULL, project_id TEXT,
 grams INTEGER NOT NULL CHECK(grams<>0),
 kind text NOT NULL CHECK(kind IN ('receipt','consumption','return','adjustment')),
 reason text NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (now()),
 FOREIGN KEY(owner_id,receipt_id) REFERENCES receipts(owner_id,id),
 FOREIGN KEY(owner_id,project_id) REFERENCES projects(owner_id,id),
 CHECK((kind='receipt' AND grams>0 AND project_id IS NULL) OR
       (kind='consumption' AND grams<0 AND project_id IS NOT NULL) OR
       (kind='return' AND grams>0 AND project_id IS NOT NULL) OR
       (kind='adjustment' AND project_id IS NULL AND length(reason)>0))
) STRICT;
CREATE TABLE historical_usage (
 owner_id TEXT NOT NULL REFERENCES profiles(id), project_id TEXT NOT NULL, yarn_id TEXT NOT NULL,
 grams INTEGER NOT NULL CHECK(grams>=0), PRIMARY KEY(owner_id,project_id,yarn_id),
 FOREIGN KEY(owner_id,project_id) REFERENCES projects(owner_id,id), FOREIGN KEY(owner_id,yarn_id) REFERENCES yarns(owner_id,id)
) STRICT;
CREATE TABLE sessions (
 id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()), owner_id TEXT NOT NULL REFERENCES profiles(id), project_id TEXT NOT NULL,
 started_at TEXT, ended_at TEXT, manual_seconds integer CHECK(manual_seconds>0),
 note text NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (now()),
 FOREIGN KEY(owner_id,project_id) REFERENCES projects(owner_id,id),
 CHECK((started_at IS NOT NULL AND manual_seconds IS NULL AND (ended_at IS NULL OR ended_at>=started_at)) OR
       (started_at IS NULL AND ended_at IS NULL AND manual_seconds IS NOT NULL))
) STRICT;
CREATE UNIQUE INDEX one_active_timer ON sessions(owner_id) WHERE started_at IS NOT NULL AND ended_at IS NULL;
CREATE TABLE photos (
 id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()), owner_id TEXT NOT NULL REFERENCES profiles(id), project_id TEXT NOT NULL,
 filename text NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (now()),
 FOREIGN KEY(owner_id,project_id) REFERENCES projects(owner_id,id)
) STRICT;
CREATE TABLE operations (
 owner_id TEXT NOT NULL REFERENCES profiles(id), key TEXT NOT NULL, payload_hash text NOT NULL,
 result TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (now()), PRIMARY KEY(owner_id,key)
) STRICT;
CREATE TABLE events (
 id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()), owner_id TEXT NOT NULL REFERENCES profiles(id),
 command text NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (now())
) STRICT;
CREATE INDEX receipt_yarn ON receipts(owner_id,yarn_id,purchased_on);
CREATE INDEX movement_receipt ON movements(owner_id,receipt_id);
CREATE INDEX movement_project ON movements(owner_id,project_id);
CREATE INDEX project_status ON projects(owner_id,status);
CREATE INDEX session_project ON sessions(owner_id,project_id);

CREATE TABLE import_batches (
 id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()), owner_id TEXT NOT NULL REFERENCES profiles(id),
 source_name text NOT NULL, source_hash text NOT NULL, preview TEXT NOT NULL,
 status text NOT NULL DEFAULT 'preview' CHECK(status IN ('preview','committed')),
 result TEXT, created_at TEXT NOT NULL DEFAULT (now()), committed_at TEXT,
 UNIQUE(owner_id,id), UNIQUE(owner_id,source_hash)
) STRICT;
CREATE TABLE import_items (
 owner_id TEXT NOT NULL REFERENCES profiles(id), batch_id TEXT NOT NULL, row_key text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('template','purchase','project')),
 target_id TEXT NOT NULL, data TEXT NOT NULL,
 PRIMARY KEY(owner_id,batch_id,row_key),
 FOREIGN KEY(owner_id,batch_id) REFERENCES import_batches(owner_id,id)
) STRICT;
ALTER TABLE templates ADD COLUMN source_data TEXT;
ALTER TABLE projects ADD COLUMN source_data TEXT;
ALTER TABLE projects ADD COLUMN end_month text CHECK(length(end_month)=7 AND substr(end_month,5,1)='-' AND substr(end_month,6,2) BETWEEN '01' AND '12');
ALTER TABLE projects ADD COLUMN legacy_material_cost INTEGER CHECK(legacy_material_cost>=0);
ALTER TABLE yarns ADD COLUMN personal_code text;
ALTER TABLE yarns ADD COLUMN needs_inventory INTEGER NOT NULL DEFAULT false;

CREATE TRIGGER immutable_movements_update BEFORE UPDATE ON movements BEGIN SELECT RAISE(ABORT,'Journal is append-only'); END;
CREATE TRIGGER immutable_movements_delete BEFORE DELETE ON movements BEGIN SELECT RAISE(ABORT,'Journal is append-only'); END;
