export interface User {
  id: number;
  name: string;
  email: string;
  created_at: string;
  updated_at: string;
}

export interface Source {
  id: number;
  name: string;
  slug: string;
  url?: string;
  api_source: string;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
}

export interface Article {
  id: number;
  title: string;
  description: string | null;
  content: string | null;
  author: string | null;
  url: string;
  image_url: string | null;
  published_at: string;
  source: Source;
  categories: Category[];
  api_source: string;
  api_id: string;
  created_at: string;
  updated_at: string;
}

export interface UserPreferences {
  id: number;
  user_id: number;
  preferred_categories: number[];
  preferred_sources: number[];
  preferred_authors: string[];
  email_notifications: boolean;
  update_frequency: 'daily' | 'weekly' | 'never';
  created_at: string;
  updated_at: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    current_page: number;
    from: number;
    last_page: number;
    path: string;
    per_page: number;
    to: number;
    total: number;
  };
  links: {
    first: string;
    last: string;
    prev: string | null;
    next: string | null;
  };
}

export interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials extends LoginCredentials {
  name: string;
  password_confirmation: string;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export interface ArticleFilters {
  search?: string;
  categories?: number[];
  sources?: number[];
  authors?: string[];
  from_date?: string;
  to_date?: string;
  sort_by?: 'published_at' | 'title';
  sort_order?: 'asc' | 'desc';
  per_page?: number;
  page?: number;
}

export interface PreferenceUpdatePayload {
  preferred_categories?: number[];
  preferred_sources?: number[];
  preferred_authors?: string[];
  email_notifications?: boolean;
  update_frequency?: 'daily' | 'weekly' | 'never';
}

export interface PreferencesResponse {
  preferences: UserPreferences;
  available_categories: Category[];
  available_sources: Source[];
}
