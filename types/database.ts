// Mirrors the Phase 1 to 4 migrations. Regenerate from the live project once it is
// connected: npx supabase gen types typescript --project-id <id> > types/database.ts

export type LocationPreset =
  | "home"
  | "campus"
  | "town"
  | "work"
  | "travelling"
  | "sleeping"
  | "unknown";

type Room = {
  id: string;
  name: string;
  invite_code: string;
  home_lat: number | null;
  home_lng: number | null;
  radius_m: number;
  created_at: string;
};

type RoomMember = {
  room_id: string;
  user_id: string;
  role: string;
  joined_at: string;
};

type Profile = {
  id: string;
  display_name: string;
  avatar_emoji: string;
  color: string | null;
  created_at: string;
};

type Status = {
  user_id: string;
  room_id: string;
  location_preset: LocationPreset;
  at_home: boolean | null;
  at_home_source: string | null;
  at_home_updated_at: string | null;
  hunger: number;
  bringing: string | null;
  mood_text: string | null;
  eta: string | null;
  updated_at: string;
  expires_at: string | null;
};

export type PantryKind = "grocery" | "ready_food";
export type PantryState = "have" | "low" | "out";
export type RequestKind = "errand" | "clothes" | "visitor_note" | "other";
export type Urgency = "normal" | "urgent";
export type FeedKind = "item_out" | "request_created" | "request_claimed" | "request_done";

type PantryItem = {
  id: string;
  room_id: string;
  name: string;
  kind: PantryKind;
  state: PantryState;
  updated_by: string | null;
  updated_at: string;
};

type RoomRequest = {
  id: string;
  room_id: string;
  kind: RequestKind;
  text: string;
  urgency: Urgency;
  created_by: string;
  for_user: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  done_at: string | null;
  created_at: string;
  // Set by the escalation job when an urgent request sat unclaimed for 10 minutes.
  escalated_at: string | null;
};

type FeedEvent = {
  id: number;
  room_id: string;
  kind: FeedKind;
  message: string;
  actor_id: string | null;
  created_at: string;
};

type PushSubscriptionRecord = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: string;
};

type NotificationPrefs = {
  user_id: string;
  requests: boolean;
  visitor_notes: boolean;
  food: boolean;
  bringing: boolean;
  pings: boolean;
  quiet_enabled: boolean;
  // Postgres `time`, e.g. "23:00:00".
  quiet_start: string;
  quiet_end: string;
  timezone: string;
  updated_at: string;
};

// Phase 4
export type ActivityType =
  | "class"
  | "study"
  | "gym"
  | "football"
  | "town"
  | "work"
  | "chill"
  | "nap";
export type CheckinKind = "wake" | "feel";

type Activity = {
  id: string;
  user_id: string;
  room_id: string;
  type: ActivityType;
  started_at: string;
  ended_at: string | null;
};

type EnergyCheckin = {
  id: string;
  user_id: string;
  room_id: string;
  kind: CheckinKind;
  feel: number | null;
  created_at: string;
};

type ScheduleItem = {
  id: string;
  user_id: string;
  room_id: string;
  title: string;
  type: ActivityType;
  starts_at: string;
  ends_at: string;
  // 0 = Sunday ... 6 = Saturday. Empty = one-off.
  repeat_days: number[];
  // "YYYY-MM-DD" on the phone's calendar.
  skipped_dates: string[];
  created_at: string;
};

export type Database = {
  public: {
    Tables: {
      rooms: {
        Row: Room;
        Insert: never;
        Update: Partial<Pick<Room, "name" | "home_lat" | "home_lng" | "radius_m">>;
        Relationships: [];
      };
      room_members: {
        Row: RoomMember;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      profiles: {
        Row: Profile;
        Insert: Pick<Profile, "id" | "display_name"> & Partial<Profile>;
        Update: Partial<Pick<Profile, "display_name" | "avatar_emoji" | "color">>;
        Relationships: [];
      };
      statuses: {
        Row: Status;
        Insert: Pick<Status, "user_id" | "room_id"> & Partial<Status>;
        Update: Partial<Status>;
        Relationships: [];
      };
      // Insert and Update list only the columns the grants allow.
      pantry_items: {
        Row: PantryItem;
        Insert: Pick<PantryItem, "room_id" | "name"> & Partial<Pick<PantryItem, "kind" | "state">>;
        Update: Partial<Pick<PantryItem, "name" | "kind" | "state">>;
        Relationships: [];
      };
      requests: {
        Row: RoomRequest;
        Insert: Pick<RoomRequest, "room_id" | "kind" | "text"> &
          Partial<Pick<RoomRequest, "urgency" | "for_user">>;
        Update: never;
        Relationships: [];
      };
      feed_events: {
        Row: FeedEvent;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // Saved through save_push_subscription(), so no direct insert or update.
      push_subscriptions: {
        Row: PushSubscriptionRecord;
        Insert: never;
        Update: never;
        Relationships: [];
      };
      notification_prefs: {
        Row: NotificationPrefs;
        Insert: Pick<NotificationPrefs, "user_id"> &
          Partial<Omit<NotificationPrefs, "user_id" | "updated_at">>;
        Update: Partial<Omit<NotificationPrefs, "user_id" | "updated_at">>;
        Relationships: [];
      };
      // user_id defaults to the signed-in user, so it isn't in the insert grant.
      activities: {
        Row: Activity;
        Insert: Pick<Activity, "room_id" | "type"> &
          Partial<Pick<Activity, "started_at" | "ended_at">>;
        Update: Partial<Pick<Activity, "ended_at">>;
        Relationships: [];
      };
      energy_checkins: {
        Row: EnergyCheckin;
        Insert: Pick<EnergyCheckin, "room_id" | "kind"> & Partial<Pick<EnergyCheckin, "feel">>;
        Update: never;
        Relationships: [];
      };
      schedule_items: {
        Row: ScheduleItem;
        Insert: Pick<ScheduleItem, "room_id" | "title" | "type" | "starts_at" | "ends_at"> &
          Partial<Pick<ScheduleItem, "repeat_days" | "skipped_dates">>;
        Update: Partial<
          Pick<
            ScheduleItem,
            "title" | "type" | "starts_at" | "ends_at" | "repeat_days" | "skipped_dates"
          >
        >;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      create_room: { Args: { p_name: string }; Returns: string };
      join_room: { Args: { p_code: string }; Returns: string };
      is_room_member: { Args: { p_room_id: string }; Returns: boolean };
      is_room_admin: { Args: { p_room_id: string }; Returns: boolean };
      shares_room: { Args: { p_user_id: string }; Returns: boolean };
      is_member_of: { Args: { p_room_id: string; p_user_id: string }; Returns: boolean };
      my_display_name: { Args: Record<string, never>; Returns: string };
      claim_request: { Args: { p_id: string }; Returns: RoomRequest };
      complete_request: { Args: { p_id: string }; Returns: RoomRequest };
      seed_pantry: { Args: { p_room_id: string }; Returns: number };
      save_push_subscription: {
        Args: { p_endpoint: string; p_p256dh: string; p_auth: string; p_user_agent?: string };
        Returns: undefined;
      };
      set_geo_home: { Args: { p_at_home: boolean }; Returns: undefined };
    };
    Enums: { location_preset: LocationPreset; activity_type: ActivityType };
    CompositeTypes: { [_ in never]: never };
  };
};

export type StatusRow = Status;
export type ProfileRow = Profile;
export type StatusPatch = Database["public"]["Tables"]["statuses"]["Update"];
export type PantryItemRow = PantryItem;
export type RequestRow = RoomRequest;
export type FeedEventRow = FeedEvent;
export type NotificationPrefsRow = NotificationPrefs;
export type NotificationPrefsPatch = Database["public"]["Tables"]["notification_prefs"]["Update"];
export type ActivityRow = Activity;
export type EnergyCheckinRow = EnergyCheckin;
export type ScheduleItemRow = ScheduleItem;
