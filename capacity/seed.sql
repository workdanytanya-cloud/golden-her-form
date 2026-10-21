INSERT INTO public.users (id,email,password_hash,email_verified_at,status) VALUES
('10000000-0000-4000-8000-000000000001','capacity-admin@example.invalid','$2b$12$ck49ZPHbVuRW2tFG2lm/5.sGJaNm8LOVzc5U7Wcn6NOEaFv4488Ly',now(),'active'),
('20000000-0000-4000-8000-000000000001','capacity-client-a@example.invalid','$2b$12$ck49ZPHbVuRW2tFG2lm/5.sGJaNm8LOVzc5U7Wcn6NOEaFv4488Ly',now(),'active'),
('20000000-0000-4000-8000-000000000002','capacity-client-b@example.invalid','$2b$12$ck49ZPHbVuRW2tFG2lm/5.sGJaNm8LOVzc5U7Wcn6NOEaFv4488Ly',now(),'active')
ON CONFLICT (id) DO NOTHING;
INSERT INTO public.user_roles (user_id,role) VALUES
('10000000-0000-4000-8000-000000000001','admin'),
('20000000-0000-4000-8000-000000000001','client'),
('20000000-0000-4000-8000-000000000002','client') ON CONFLICT DO NOTHING;
INSERT INTO public.profiles (id,full_name) VALUES
('20000000-0000-4000-8000-000000000001','Тестовый клиент A'),
('20000000-0000-4000-8000-000000000002','Тестовый клиент B') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.client_access (user_id,status,unlock_source,activated_at,activated_by) VALUES
('20000000-0000-4000-8000-000000000001','active','payment',now(),'10000000-0000-4000-8000-000000000001'),
('20000000-0000-4000-8000-000000000002','active','payment',now(),'10000000-0000-4000-8000-000000000001') ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.client_courses (id,client_id,title,start_date,end_date,status,program_scope,created_by) VALUES
('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Курс A',current_date,current_date+27,'active','both','10000000-0000-4000-8000-000000000001'),
('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000002','Курс B',current_date,current_date+27,'active','both','10000000-0000-4000-8000-000000000001') ON CONFLICT (id) DO NOTHING;
