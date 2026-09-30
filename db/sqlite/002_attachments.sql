-- Attachments replace photos: one file belongs to exactly one of project, template or yarn.
-- Yarn/template/library owners are added to the UI in later versions; the schema is ready now.
CREATE TABLE attachments (
 id TEXT PRIMARY KEY DEFAULT (gen_random_uuid()), owner_id TEXT NOT NULL REFERENCES profiles(id),
 project_id TEXT, template_id TEXT, yarn_id TEXT,
 kind text NOT NULL DEFAULT 'photo' CHECK(kind IN ('photo','schema','file')),
 media_type text NOT NULL DEFAULT 'image/jpeg' CHECK(media_type IN ('image/jpeg','application/pdf')),
 filename text NOT NULL UNIQUE, original_name text NOT NULL DEFAULT '', caption text NOT NULL DEFAULT '',
 sort_order INTEGER NOT NULL DEFAULT 0, is_cover INTEGER NOT NULL DEFAULT false CHECK(is_cover IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (now()),
 FOREIGN KEY(owner_id,project_id) REFERENCES projects(owner_id,id),
 FOREIGN KEY(owner_id,template_id) REFERENCES templates(owner_id,id),
 FOREIGN KEY(owner_id,yarn_id) REFERENCES yarns(owner_id,id),
 CHECK((project_id IS NOT NULL)+(template_id IS NOT NULL)+(yarn_id IS NOT NULL)=1)
) STRICT;
CREATE INDEX attachment_project ON attachments(owner_id,project_id,sort_order);
CREATE INDEX attachment_template ON attachments(owner_id,template_id,sort_order);
CREATE INDEX attachment_yarn ON attachments(owner_id,yarn_id,sort_order);
CREATE UNIQUE INDEX attachment_cover_project ON attachments(owner_id,project_id) WHERE is_cover=1 AND project_id IS NOT NULL;
CREATE UNIQUE INDEX attachment_cover_template ON attachments(owner_id,template_id) WHERE is_cover=1 AND template_id IS NOT NULL;
CREATE UNIQUE INDEX attachment_cover_yarn ON attachments(owner_id,yarn_id) WHERE is_cover=1 AND yarn_id IS NOT NULL;

-- Existing photos keep their ids and files; the oldest photo of a project becomes its cover.
INSERT INTO attachments(id,owner_id,project_id,filename,created_at,sort_order,is_cover)
SELECT id,owner_id,project_id,filename,created_at,
 ROW_NUMBER() OVER (PARTITION BY owner_id,project_id ORDER BY created_at,rowid)-1,
 ROW_NUMBER() OVER (PARTITION BY owner_id,project_id ORDER BY created_at,rowid)=1
FROM photos;
DROP TABLE photos;
