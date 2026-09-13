
GRANT SELECT ON public.dishes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nutrition_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.nutrition_plan_days TO authenticated;
GRANT ALL ON public.dishes TO service_role;
GRANT ALL ON public.nutrition_plans TO service_role;
GRANT ALL ON public.nutrition_plan_days TO service_role;
