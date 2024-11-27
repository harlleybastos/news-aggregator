import axios from 'axios';
import { PreferencesResponse } from '../types/index';
import type {
  Article,
  PaginatedResponse,
  LoginCredentials,
  RegisterCredentials,
  AuthResponse,
  UserPreferences,
  ArticleFilters,
  PreferenceUpdatePayload,
  ApiError,
} from '../types';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers!.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  login: async (credentials: LoginCredentials): Promise<AuthResponse> => {
    const response = await api.post<AuthResponse>('/login', credentials);
    return response.data;
  },

  register: async (credentials: RegisterCredentials): Promise<AuthResponse> => {
    const response = await api.post<AuthResponse>('/register', credentials);
    return response.data;
  },

  logout: async (): Promise<void> => {
    await api.post('/logout');
  },
};

export const articlesApi = {
  getArticles: async (filters: ArticleFilters): Promise<PaginatedResponse<Article>> => {
    const response = await api.get<PaginatedResponse<Article>>('/articles', {
      params: filters,
    });
    return response.data;
  },

  getArticle: async (id: number): Promise<Article> => {
    const response = await api.get<Article>(`/articles/${id}`);
    return response.data;
  },

  getUserFeed: async (filters: Partial<ArticleFilters>): Promise<PaginatedResponse<Article>> => {
    const response = await api.get<PaginatedResponse<Article>>('/articles/feed', {
      params: filters,
    });
    return response.data;
  },
};

export const preferencesApi = {
  getPreferences: async (): Promise<PreferencesResponse> => {
    const response = await api.get<PreferencesResponse>('/preferences');
    return response.data;
  },

  updatePreferences: async (payload: PreferenceUpdatePayload): Promise<UserPreferences> => {
    const response = await api.put<UserPreferences>('/preferences', payload);
    return response.data;
  },
};

export type { ApiError };
export default api;
