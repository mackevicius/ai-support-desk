CREATE TABLE support_tickets (
  id integer PRIMARY KEY,
  customer_name text NOT NULL,
  subject text NOT NULL,
  question text NOT NULL,
  status text NOT NULL,
  priority text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE ticket_events (
  id integer PRIMARY KEY,
  ticket_id integer NOT NULL REFERENCES support_tickets(id),
  description text NOT NULL,
  created_at timestamptz NOT NULL
);

INSERT INTO support_tickets (id, customer_name, subject, question, status, priority, created_at) VALUES
  (1, 'Maya Chen', 'Team invitations are not arriving', 'I invited three teammates this morning, but none of them received an email. Can you help us get access before our onboarding call?', 'open', 'high', '2026-09-20T10:00:00Z'),
  (2, 'Luis Ortega', 'Where can I download invoices?', 'I need a copy of our August invoice for accounting. Where do I find it?', 'open', 'normal', '2026-09-19T14:30:00Z'),
  (3, 'Samira Khan', 'Dashboard numbers look out of date', 'Our usage dashboard has not changed since yesterday. Is reporting delayed?', 'pending', 'high', '2026-09-18T09:15:00Z'),
  (4, 'Elliot Park', 'Change workspace name', 'Can I rename our workspace without changing existing links?', 'resolved', 'low', '2026-09-16T16:45:00Z');

INSERT INTO ticket_events (id, ticket_id, description, created_at) VALUES
  (1, 1, 'Request received', '2026-09-20T10:00:00Z'),
  (2, 1, 'Assigned to the support inbox', '2026-09-20T10:05:00Z'),
  (3, 2, 'Request received', '2026-09-19T14:30:00Z'),
  (4, 3, 'Request received', '2026-09-18T09:15:00Z'),
  (5, 3, 'Agent requested more details about the reporting period', '2026-09-18T11:20:00Z'),
  (6, 4, 'Request received', '2026-09-16T16:45:00Z'),
  (7, 4, 'Agent answered and marked the request resolved', '2026-09-17T08:00:00Z');