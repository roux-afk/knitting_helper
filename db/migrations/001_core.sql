CREATE TABLE profiles (
 id uuid PRIMARY KEY, hourly_rate numeric(14,2) NOT NULL DEFAULT 125 CHECK(hourly_rate>=0),
 timezone text NOT NULL DEFAULT 'Europe/Moscow'
);
INSERT INTO profiles(id) VALUES('00000000-0000-4000-8000-000000000001');

CREATE TABLE templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES profiles,
 title text NOT NULL, category text NOT NULL, notes text NOT NULL DEFAULT '',
 rate numeric(14,2) NOT NULL DEFAULT 125, price numeric(14,2), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id)
);
CREATE TABLE projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES profiles,
 template_id uuid, title text NOT NULL, category text NOT NULL, notes text NOT NULL DEFAULT '',
 quantity integer NOT NULL DEFAULT 1 CHECK(quantity>0), purpose text NOT NULL CHECK(purpose IN ('self','gift','sale')),
 status text NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','active','paused','completed','cancelled')),
 start_date date, end_date date, rate numeric(14,2) NOT NULL CHECK(rate>=0),
 price numeric(14,2) CHECK(price>=0), other_cost numeric(14,2) NOT NULL DEFAULT 0 CHECK(other_cost>=0),
 historical boolean NOT NULL DEFAULT false, archived boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(owner_id,id), FOREIGN KEY(owner_id,template_id) REFERENCES templates(owner_id,id),
 CHECK(end_date IS NULL OR start_date IS NULL OR end_date>=start_date)
);
CREATE TABLE yarns (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES profiles,
 manufacturer text NOT NULL, name text NOT NULL, color text NOT NULL, color_hex text NOT NULL DEFAULT '#9987ad',
 composition text NOT NULL, skein_weight numeric(14,3) NOT NULL CHECK(skein_weight>0),
 skein_length numeric(14,3) CHECK(skein_length>0), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,id)
);
CREATE TABLE receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES profiles,
 yarn_id uuid NOT NULL, grams numeric(14,3) NOT NULL CHECK(grams>0), cost numeric(14,2) CHECK(cost>=0),
 skein_weight numeric(14,3) NOT NULL CHECK(skein_weight>0), skein_length numeric(14,3),
 dye_lot text NOT NULL DEFAULT '', purchased_on date NOT NULL, note text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,id),
 FOREIGN KEY(owner_id,yarn_id) REFERENCES yarns(owner_id,id)
);
CREATE TABLE movements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES profiles,
 receipt_id uuid NOT NULL, project_id uuid,
 grams numeric(14,3) NOT NULL CHECK(grams<>0),
 kind text NOT NULL CHECK(kind IN ('receipt','consumption','return','adjustment')),
 reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(owner_id,receipt_id) REFERENCES receipts(owner_id,id),
 FOREIGN KEY(owner_id,project_id) REFERENCES projects(owner_id,id),
 CHECK((kind='receipt' AND grams>0 AND project_id IS NULL) OR
       (kind='consumption' AND grams<0 AND project_id IS NOT NULL) OR
       (kind='return' AND grams>0 AND project_id IS NOT NULL) OR
       (kind='adjustment' AND project_id IS NULL AND length(reason)>0))
);
CREATE TABLE historical_usage (
 owner_id uuid NOT NULL REFERENCES profiles, project_id uuid NOT NULL, yarn_id uuid NOT NULL,
 grams numeric(14,3) NOT NULL CHECK(grams>=0), PRIMARY KEY(owner_id,project_id,yarn_id),
 FOREIGN KEY(owner_id,project_id) REFERENCES projects(owner_id,id), FOREIGN KEY(owner_id,yarn_id) REFERENCES yarns(owner_id,id)
);
CREATE TABLE sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES profiles, project_id uuid NOT NULL,
 started_at timestamptz, ended_at timestamptz, manual_seconds integer CHECK(manual_seconds>0),
 note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(owner_id,project_id) REFERENCES projects(owner_id,id),
 CHECK((started_at IS NOT NULL AND manual_seconds IS NULL AND (ended_at IS NULL OR ended_at>=started_at)) OR
       (started_at IS NULL AND ended_at IS NULL AND manual_seconds IS NOT NULL))
);
CREATE UNIQUE INDEX one_active_timer ON sessions(owner_id) WHERE started_at IS NOT NULL AND ended_at IS NULL;
CREATE TABLE photos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES profiles, project_id uuid NOT NULL,
 filename text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(owner_id,project_id) REFERENCES projects(owner_id,id)
);
CREATE TABLE operations (
 owner_id uuid NOT NULL REFERENCES profiles, key uuid NOT NULL, payload_hash text NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,key)
);
CREATE TABLE events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL REFERENCES profiles,
 command text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX receipt_yarn ON receipts(owner_id,yarn_id,purchased_on);
CREATE INDEX movement_receipt ON movements(owner_id,receipt_id);
CREATE INDEX movement_project ON movements(owner_id,project_id);
CREATE INDEX project_status ON projects(owner_id,status);
CREATE INDEX session_project ON sessions(owner_id,project_id);
CREATE OR REPLACE FUNCTION reject_movement_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Journal is append-only'; END;
$$;
CREATE TRIGGER immutable_movements BEFORE UPDATE OR DELETE ON movements FOR EACH ROW EXECUTE FUNCTION reject_movement_change();
