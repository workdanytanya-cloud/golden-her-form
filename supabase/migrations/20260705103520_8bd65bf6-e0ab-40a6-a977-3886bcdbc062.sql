UPDATE public.exercises SET gif_url = v.url FROM (VALUES
  ('bodyweight-squat', '/__l5e/assets-v1/9ccb61a3-f3bb-4e3a-9d42-9043f5fd9a15/bodyweight-squat.mp4'),
  ('pushup', '/__l5e/assets-v1/2a00bdc7-9820-4825-ba3d-4b64a078c49d/pushup.mp4'),
  ('plank', '/__l5e/assets-v1/7df977c3-9d91-4669-95be-013295a4ddae/plank.mp4'),
  ('glute-bridge', '/__l5e/assets-v1/569dee1d-c649-46c3-863b-d02b0cbe9d85/glute-bridge.mp4'),
  ('reverse-lunge', '/__l5e/assets-v1/fc26d56b-dbb4-4b01-be4c-85392ba31adf/reverse-lunge.mp4')
) AS v(slug, url) WHERE exercises.slug = v.slug;