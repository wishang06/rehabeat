// Generated from the Supabase schema (supabase/migrations), trimmed to the
// Database type. Regenerate after changing the schema.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.18';
  };
  public: {
    Tables: {
      care_patients: {
        Row: {
          condition: string;
          created_at: string;
          display_name: string;
          doctor_id: string;
          id: string;
          join_code: string;
          patient_id: string | null;
        };
        Insert: { condition?: string; display_name: string };
        Update: { condition?: string; display_name?: string };
        Relationships: [];
      };
      care_prescriptions: {
        Row: { body: Json; care_patient_id: string; created_at: string; id: string; version: number };
        Insert: { body: Json; care_patient_id: string; created_at?: string; id?: string; version: number };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      care_sessions: {
        Row: {
          body: Json;
          care_patient_id: string;
          completed: boolean;
          created_at: string;
          day: string;
          id: string;
          prescription_id: string;
        };
        Insert: {
          body: Json;
          care_patient_id: string;
          completed: boolean;
          created_at?: string;
          day: string;
          id: string;
          prescription_id: string;
        };
        Update: { [_ in never]: never };
        Relationships: [];
      };
      profiles: {
        Row: {
          avatar_id: string | null;
          avatar_url: string | null;
          created_at: string;
          display_name: string;
          id: string;
          is_sample: boolean;
        };
        Insert: {
          avatar_id?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          display_name: string;
          id: string;
          is_sample?: boolean;
        };
        Update: {
          avatar_id?: string | null;
          avatar_url?: string | null;
          created_at?: string;
          display_name?: string;
          id?: string;
          is_sample?: boolean;
        };
        Relationships: [];
      };
      scores: {
        Row: {
          accuracy: number;
          best_combo: number;
          created_at: string;
          duration_sec: number;
          good: number;
          id: number;
          miss: number;
          moves: number;
          perfect: number;
          points: number;
          user_id: string;
        };
        Insert: {
          accuracy: number;
          best_combo: number;
          created_at?: string;
          duration_sec: number;
          good: number;
          id?: never;
          miss: number;
          moves: number;
          perfect: number;
          points: number;
          user_id?: string;
        };
        Update: {
          accuracy?: number;
          best_combo?: number;
          created_at?: string;
          duration_sec?: number;
          good?: number;
          id?: never;
          miss?: number;
          moves?: number;
          perfect?: number;
          points?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'scores_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      leaderboard: {
        Row: {
          avatar_id: string | null;
          avatar_url: string | null;
          best_accuracy: number | null;
          best_combo: number | null;
          best_points: number | null;
          display_name: string | null;
          is_sample: boolean | null;
          rank: number | null;
          runs: number | null;
          total_points: number | null;
          user_id: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      claim_care_code: { Args: { code: string }; Returns: string };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
