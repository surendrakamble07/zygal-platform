-- ZYGAL platform - Migration 6: starting dropdown values (from the cleaned master-sheet lists)

insert into public.call_types (name, sort_order) values
  ('Installation',10),('Activation',20),('Activity',30),('Service Call',40)
on conflict do nothing;

insert into public.handover_statuses (name, sort_order) values ('Pending',10),('Done',20)
on conflict do nothing;

insert into public.final_statuses (name, sort_order) values
  ('WIP',10),('Completed',20),('Live',30),('Partially Live',40),('Pending',50),('Other',60)
on conflict do nothing;

insert into public.material_items (name, sort_order) values
  ('Jio Tag',10),('Strike Lock',20),('IPC Camera',30),('Pinhole Camera',40),('HDD',50),('NVR',60),
  ('Link Device',70),('Smoke/Fire Sensor',80),('Hooter',90),('Router',100),('Asset Tracker',110),
  ('TAM Device',120),('SD Card',130),('Other',999)
on conflict do nothing;

insert into public.material_problems (name, sort_order) values
  ('Not Delivered',10),('Faulty',20),('Wrong Material Delivered',30),('Not Pinging',40),('Other',999)
on conflict do nothing;

insert into public.checklist_items (name, sort_order) values
  ('Link Plotted',10),('NVR Added',20),('IP Panel Added',30),('IPC Camera Added',40),('EM Panel Added',50),
  ('Asset Tracker Added',60),('Smart I Panel Added',70),('Asset Receiver Added',80),('Backend Done',90),
  ('FR Testing',100),('IP Panel Testing',110),('Smoke Alert Test',120),('Handover Done',130)
on conflict do nothing;

insert into public.checklist_results (name, sort_order) values
  ('Done',10),('Pending',20),('Failed',30),('Not Applicable',40)
on conflict do nothing;

insert into public.states (name) values
  ('Andhra Pradesh'),('Arunachal Pradesh'),('Assam'),('Bihar'),('Chhattisgarh'),('Goa'),('Gujarat'),
  ('Haryana'),('Himachal Pradesh'),('Jharkhand'),('Karnataka'),('Kerala'),('Madhya Pradesh'),
  ('Maharashtra'),('Manipur'),('Meghalaya'),('Mizoram'),('Nagaland'),('Odisha'),('Punjab'),
  ('Rajasthan'),('Sikkim'),('Tamil Nadu'),('Telangana'),('Tripura'),('Uttar Pradesh'),('Uttarakhand'),
  ('West Bengal'),('Andaman and Nicobar Islands'),('Chandigarh'),
  ('Dadra and Nagar Haveli and Daman and Diu'),('Delhi'),('Jammu and Kashmir'),('Ladakh'),
  ('Lakshadweep'),('Puducherry')
on conflict do nothing;

insert into public.projects (name) values
  ('Bajaj'),('IDFC Bharat'),('L&T'),('Capri'),('IIFL EYE'),('TVS'),('ABCL'),
  ('Poonawala'),('Nayara'),('Herbalife')
on conflict do nothing;

insert into public.project_types (project_id, name)
select p.id, v.type_name
from (values
  ('Bajaj','SGL'),('Bajaj','GL'),('Bajaj','R-Next'),
  ('IDFC Bharat','BHARAT'),('IDFC Bharat','CPC'),('IDFC Bharat','BANK'),
  ('L&T','L&T'),('Capri','Capri'),
  ('IIFL EYE','EYE'),('IIFL EYE','IIFL'),
  ('TVS','TVS GOLD'),('TVS','TVS'),
  ('ABCL','Aditya Birla'),('ABCL','Aditya Birla Capital'),
  ('Poonawala','Poonawala'),('Nayara','Nayara Petrol Pump'),('Herbalife','Herbalife')
) as v(project_name, type_name)
join public.projects p on p.name = v.project_name
on conflict do nothing;
