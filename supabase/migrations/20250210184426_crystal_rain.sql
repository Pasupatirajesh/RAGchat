/*
  # Create documents table with vector support

  1. New Tables
    - `documents`
      - `id` (uuid, primary key)
      - `content` (text)
      - `embedding` (vector)
      - `metadata` (jsonb)
      - `created_at` (timestamp)

  2. Security
    - Enable RLS on `documents` table
    - Add policies for authenticated users to read documents
*/

-- Enable the vector extension
create extension if not exists vector;

-- Create the documents table
create table if not exists documents (
    id uuid primary key default gen_random_uuid(),
    content text not null,
    embedding vector(1536),
    metadata jsonb default '{}'::jsonb,
    created_at timestamptz default now()
);

-- Create a function to compute vector similarity
create or replace function match_documents(
    query_embedding vector(1536),
    match_threshold float,
    match_count int
)
returns table (
    id uuid,
    content text,
    similarity float
)
language sql stable
as $$
    select
        id,
        content,
        1 - (embedding <=> query_embedding) as similarity
    from documents
    where 1 - (embedding <=> query_embedding) > match_threshold
    order by similarity desc
    limit match_count;
$$;

-- Enable RLS
alter table documents enable row level security;

-- Create policy for reading documents
create policy "Allow read access to documents"
    on documents
    for select
    to authenticated
    using (true);