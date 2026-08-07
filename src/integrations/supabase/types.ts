export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_notifications: {
        Row: {
          client_id: string
          created_at: string
          id: string
          is_read: boolean
          measurement_id: string | null
          message: string
          type: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          is_read?: boolean
          measurement_id?: string | null
          message: string
          type?: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          is_read?: boolean
          measurement_id?: string | null
          message?: string
          type?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          id: string
          created_at: string
          updated_at: string
          full_name: string
          age: number
          phone: string
          email: string
          messenger: string
          source: string
          program_slug: string | null
          program_title: string | null
          message: string | null
          status: string
          notes: string | null
        }
        Insert: {
          id?: string
          created_at?: string
          updated_at?: string
          full_name: string
          age: number
          phone: string
          email: string
          messenger?: string
          source?: string
          program_slug?: string | null
          program_title?: string | null
          message?: string | null
          status?: string
          notes?: string | null
        }
        Update: {
          id?: string
          created_at?: string
          updated_at?: string
          full_name?: string
          age?: number
          phone?: string
          email?: string
          messenger?: string
          source?: string
          program_slug?: string | null
          program_title?: string | null
          message?: string | null
          status?: string
          notes?: string | null
        }
        Relationships: []
      }
      client_access: {
        Row: {
          activated_at: string | null
          activated_by: string | null
          created_at: string
          notes: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          notes?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          activated_by?: string | null
          created_at?: string
          notes?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      client_notifications: {
        Row: {
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          message: string
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message: string
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          message?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      dishes: {
        Row: {
          calories_per_100g: number
          carbs_per_100g: number
          created_at: string
          description: string | null
          fat_per_100g: number
          id: string
          image_url: string | null
          ingredients: Json
          meal_type: string
          name: string
          portion_weight_g: number
          protein_per_100g: number
          replacements: string[]
          slug: string
          steps: Json
          tags: string[]
          updated_at: string
          video_url: string | null
        }
        Insert: {
          calories_per_100g: number
          carbs_per_100g: number
          created_at?: string
          description?: string | null
          fat_per_100g: number
          id?: string
          image_url?: string | null
          ingredients?: Json
          meal_type: string
          name: string
          portion_weight_g: number
          protein_per_100g: number
          replacements?: string[]
          slug: string
          steps?: Json
          tags?: string[]
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          calories_per_100g?: number
          carbs_per_100g?: number
          created_at?: string
          description?: string | null
          fat_per_100g?: number
          id?: string
          image_url?: string | null
          ingredients?: Json
          meal_type?: string
          name?: string
          portion_weight_g?: number
          protein_per_100g?: number
          replacements?: string[]
          slug?: string
          steps?: Json
          tags?: string[]
          updated_at?: string
          video_url?: string | null
        }
        Relationships: []
      }
      exercises: {
        Row: {
          category: string
          common_mistakes: Json
          created_at: string
          cues: Json
          default_reps: string
          default_sets: number
          description: string | null
          difficulty: string
          equipment: string[]
          gif_url: string | null
          id: string
          muscle_groups: string[]
          name: string
          rest_seconds: number
          slug: string
          tags: string[]
          tempo: string | null
          updated_at: string
          video_url: string | null
        }
        Insert: {
          category: string
          common_mistakes?: Json
          created_at?: string
          cues?: Json
          default_reps?: string
          default_sets?: number
          description?: string | null
          difficulty?: string
          equipment?: string[]
          gif_url?: string | null
          id?: string
          muscle_groups?: string[]
          name: string
          rest_seconds?: number
          slug: string
          tags?: string[]
          tempo?: string | null
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          category?: string
          common_mistakes?: Json
          created_at?: string
          cues?: Json
          default_reps?: string
          default_sets?: number
          description?: string | null
          difficulty?: string
          equipment?: string[]
          gif_url?: string | null
          id?: string
          muscle_groups?: string[]
          name?: string
          rest_seconds?: number
          slug?: string
          tags?: string[]
          tempo?: string | null
          updated_at?: string
          video_url?: string | null
        }
        Relationships: []
      }
      measurements: {
        Row: {
          chest_cm: number | null
          created_at: string
          hips_cm: number | null
          id: string
          measured_on: string
          note: string | null
          updated_at: string
          user_id: string
          waist_cm: number | null
          weight_kg: number | null
        }
        Insert: {
          chest_cm?: number | null
          created_at?: string
          hips_cm?: number | null
          id?: string
          measured_on?: string
          note?: string | null
          updated_at?: string
          user_id: string
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Update: {
          chest_cm?: number | null
          created_at?: string
          hips_cm?: number | null
          id?: string
          measured_on?: string
          note?: string | null
          updated_at?: string
          user_id?: string
          waist_cm?: number | null
          weight_kg?: number | null
        }
        Relationships: []
      }
      nutrition_plan_days: {
        Row: {
          created_at: string
          day_index: number
          day_note: string | null
          id: string
          meals: Json
          plan_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          day_index: number
          day_note?: string | null
          id?: string
          meals?: Json
          plan_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          day_index?: number
          day_note?: string | null
          id?: string
          meals?: Json
          plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "nutrition_plan_days_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "nutrition_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      nutrition_plans: {
        Row: {
          created_at: string
          excluded_products: string[]
          generated_at: string
          id: string
          meals_per_day: number
          notes: string | null
          preferred_products: string[]
          target_carbs_g: number
          target_fat_g: number
          target_kcal: number
          target_protein_g: number
          targets_manual: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          excluded_products?: string[]
          generated_at?: string
          id?: string
          meals_per_day?: number
          notes?: string | null
          preferred_products?: string[]
          target_carbs_g: number
          target_fat_g: number
          target_kcal: number
          target_protein_g: number
          targets_manual?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          excluded_products?: string[]
          generated_at?: string
          id?: string
          meals_per_day?: number
          notes?: string | null
          preferred_products?: string[]
          target_carbs_g?: number
          target_fat_g?: number
          target_kcal?: number
          target_protein_g?: number
          targets_manual?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      onboarding_responses: {
        Row: {
          activity_level: string | null
          alcohol_frequency: string | null
          allergies: string | null
          completed_at: string | null
          created_at: string
          diet_type: string | null
          disliked_foods: string | null
          energy_level: number | null
          equipment: string[] | null
          expectations: string | null
          experience: string | null
          extra: Json | null
          favorite_foods: string | null
          focus_areas: string[] | null
          goal_details: string | null
          goal_primary: string | null
          has_injuries: boolean | null
          health_conditions: string | null
          id: string
          injuries_details: string | null
          job_type: string | null
          meals_per_day: number | null
          medications: string | null
          motivation: string | null
          pregnancy_status: string | null
          previous_experience: string | null
          session_duration_min: number | null
          sleep_hours: number | null
          smoking: boolean | null
          stress_level: number | null
          timeframe: string | null
          training_days_per_week: number | null
          training_location: string | null
          updated_at: string
          user_id: string
          water_liters: number | null
        }
        Insert: {
          activity_level?: string | null
          alcohol_frequency?: string | null
          allergies?: string | null
          completed_at?: string | null
          created_at?: string
          diet_type?: string | null
          disliked_foods?: string | null
          energy_level?: number | null
          equipment?: string[] | null
          expectations?: string | null
          experience?: string | null
          extra?: Json | null
          favorite_foods?: string | null
          focus_areas?: string[] | null
          goal_details?: string | null
          goal_primary?: string | null
          has_injuries?: boolean | null
          health_conditions?: string | null
          id?: string
          injuries_details?: string | null
          job_type?: string | null
          meals_per_day?: number | null
          medications?: string | null
          motivation?: string | null
          pregnancy_status?: string | null
          previous_experience?: string | null
          session_duration_min?: number | null
          sleep_hours?: number | null
          smoking?: boolean | null
          stress_level?: number | null
          timeframe?: string | null
          training_days_per_week?: number | null
          training_location?: string | null
          updated_at?: string
          user_id: string
          water_liters?: number | null
        }
        Update: {
          activity_level?: string | null
          alcohol_frequency?: string | null
          allergies?: string | null
          completed_at?: string | null
          created_at?: string
          diet_type?: string | null
          disliked_foods?: string | null
          energy_level?: number | null
          equipment?: string[] | null
          expectations?: string | null
          experience?: string | null
          extra?: Json | null
          favorite_foods?: string | null
          focus_areas?: string[] | null
          goal_details?: string | null
          goal_primary?: string | null
          has_injuries?: boolean | null
          health_conditions?: string | null
          id?: string
          injuries_details?: string | null
          job_type?: string | null
          meals_per_day?: number | null
          medications?: string | null
          motivation?: string | null
          pregnancy_status?: string | null
          previous_experience?: string | null
          session_duration_min?: number | null
          sleep_hours?: number | null
          smoking?: boolean | null
          stress_level?: number | null
          timeframe?: string | null
          training_days_per_week?: number | null
          training_location?: string | null
          updated_at?: string
          user_id?: string
          water_liters?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          birth_date: string | null
          created_at: string
          full_name: string | null
          gender: string | null
          goal: string | null
          height_cm: number | null
          id: string
          phone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          birth_date?: string | null
          created_at?: string
          full_name?: string | null
          gender?: string | null
          goal?: string | null
          height_cm?: number | null
          id: string
          phone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          birth_date?: string | null
          created_at?: string
          full_name?: string | null
          gender?: string | null
          goal?: string | null
          height_cm?: number | null
          id?: string
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      training_program_days: {
        Row: {
          cooldown: Json
          created_at: string
          day_index: number
          day_note: string | null
          description: string | null
          exercises: Json
          focus: string | null
          id: string
          is_rest: boolean
          program_id: string
          title: string
          updated_at: string
          warmup: Json
        }
        Insert: {
          cooldown?: Json
          created_at?: string
          day_index: number
          day_note?: string | null
          description?: string | null
          exercises?: Json
          focus?: string | null
          id?: string
          is_rest?: boolean
          program_id: string
          title?: string
          updated_at?: string
          warmup?: Json
        }
        Update: {
          cooldown?: Json
          created_at?: string
          day_index?: number
          day_note?: string | null
          description?: string | null
          exercises?: Json
          focus?: string | null
          id?: string
          is_rest?: boolean
          program_id?: string
          title?: string
          updated_at?: string
          warmup?: Json
        }
        Relationships: [
          {
            foreignKeyName: "training_program_days_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "training_programs"
            referencedColumns: ["id"]
          },
        ]
      }
      training_programs: {
        Row: {
          created_at: string
          equipment: string[]
          faq: Json
          generated_at: string
          goal: string | null
          has_injuries: boolean
          id: string
          injuries_details: string | null
          level: string
          location: string | null
          notes: string | null
          sessions_per_week: number
          targets_manual: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          equipment?: string[]
          faq?: Json
          generated_at?: string
          goal?: string | null
          has_injuries?: boolean
          id?: string
          injuries_details?: string | null
          level?: string
          location?: string | null
          notes?: string | null
          sessions_per_week?: number
          targets_manual?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          equipment?: string[]
          faq?: Json
          generated_at?: string
          goal?: string | null
          has_injuries?: boolean
          id?: string
          injuries_details?: string | null
          level?: string
          location?: string | null
          notes?: string | null
          sessions_per_week?: number
          targets_manual?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "client"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "client"],
    },
  },
} as const
