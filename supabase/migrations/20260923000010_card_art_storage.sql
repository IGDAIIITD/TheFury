-- Campus Forge → Supabase
-- Migration 10/10: storage bucket `card-art` for card images.
-- Replaces backend CardArtConfig (`file:../card-art/`). Public read so the
-- PWA can hotlink {bucket}/public/{slug}.jpg on GitHub Pages; uploads happen
-- via setup/download-card-art.ps1 with the service role key (RLS-bypassing).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-art', 'card-art', true, 52428800, array['image/jpeg', 'image/png'])
on conflict (id) do update
set public = true, file_size_limit = 52428800,
    allowed_mime_types = array['image/jpeg', 'image/png'];

-- Public read on objects in the bucket (anonymous download for <img> tags).
-- The select policy covers the browser fetching public URLs without auth.
do $$
begin
    if not exists (
        select 1 from pg_policies
        where schemaname = 'storage' and tablename = 'objects' and policyname = 'card-art public read'
    ) then
        create policy "card-art public read" on storage.objects
            for select to anon, authenticated
            using (bucket_id = 'card-art');
    end if;
end;
$$;