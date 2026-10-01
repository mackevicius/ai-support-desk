CREATE TABLE support_tickets (
  id integer PRIMARY KEY,
  session_id text,
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

CREATE SEQUENCE support_ticket_ids START WITH 6;
CREATE SEQUENCE ticket_event_ids START WITH 11;