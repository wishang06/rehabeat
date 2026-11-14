// Generated from the Supabase schema (supabase/migrations), trimmed to the
// Database type. Regenerate after changing the schema.

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: '14.18';
  };
  public: {
    Tables: {
      profiles: {
        Row: { avatar_url: string | null; created_at: string; display_name: string; id: string };
        Insert: { avatar_url?: string | null; created_at?: string; display_name: string; id: string };
        Update: { avatar_url?: string | null; created_at?: string; display_name?: string; id?: string };
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
          avatar_url: string | null;
          best_accuracy: number | null;
          best_combo: number | null;
          best_points: number | null;
          display_name: string | null;
          rank: number | null;
          runs: number | null;
          total_points: number | null;
          user_id: string | null;
        };
        Relationships: [];
      };
    };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
