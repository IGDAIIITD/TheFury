-- Assign degree programs / specializations to the seeded demo accounts.
-- B.Tech specializations: CSE, CSAI, CSAM, CSB, CSSS, CSD, CSECON, ECE, EVE
-- M.Tech specializations: CSE, ECE
UPDATE players SET degree_level = 'BTECH', specialization = 'CSAI' WHERE email = 'testbattle@campus.edu';
UPDATE players SET degree_level = 'MTECH', specialization = 'CSE'  WHERE email = 'opponent@campus.edu';
UPDATE players SET degree_level = 'BTECH', specialization = 'CSD'  WHERE email = 'dave@campus.edu';
UPDATE players SET degree_level = 'BTECH', specialization = 'ECE'  WHERE email = 'test2@gmail.com';
UPDATE players SET degree_level = 'MTECH', specialization = 'ECE'  WHERE email = 'test0@gmail.com';
UPDATE players SET degree_level = 'BTECH', specialization = 'CSE'  WHERE email = 'a@iiitd.ac.in';
