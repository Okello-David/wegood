// Mirrors the Phase 1 migration. Regenerate from the live project once it is
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
    };
    Views: { [_ in never]: never };
    Functions: {
      create_room: { Args: { p_name: string }; Returns: string };
      join_room: { Args: { p_code: string }; Returns: string };
      is_room_member: { Args: { p_room_id: string }; Returns: boolean };
      is_room_admin: { Args: { p_room_id: string }; Returns: boolean };
      shares_room: { Args: { p_user_id: string }; Returns: boolean };
    };
    Enums: { location_preset: LocationPreset };
    CompositeTypes: { [_ in never]: never };
  };
};

export type StatusRow = Status;
export type ProfileRow = Profile;
export type StatusPatch = Database["public"]["Tables"]["statuses"]["Update"];
