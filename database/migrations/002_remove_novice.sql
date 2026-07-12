-- Design change D-025: Novice removed; players pick 1 of 4 base jobs at account creation.
-- Convert legacy Novice progress to Swordman (test-phase accounts only).
INSERT INTO jobs(account_id, job_id, level, exp, rebirth_count, stat_str, stat_dex, stat_con, stat_int, unspent_points, mastery_milestones)
SELECT account_id, 'swordman', level, exp, rebirth_count, stat_str, stat_dex, stat_con, stat_int, unspent_points, mastery_milestones
FROM jobs WHERE job_id='novice'
ON CONFLICT (account_id, job_id) DO NOTHING;

DELETE FROM jobs WHERE job_id='novice';
DELETE FROM skills_unlocked WHERE skill_id LIKE 'novice.%';
UPDATE account_state SET current_job_id='swordman' WHERE current_job_id='novice';
ALTER TABLE account_state ALTER COLUMN current_job_id SET DEFAULT 'swordman';
