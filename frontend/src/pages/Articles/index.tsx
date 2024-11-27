import React from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { articlesApi } from '../../services/api';

export default function ArticlePage() {
  const { id } = useParams<{ id: string }>();

  // Fetch article data with React Query
  const {
    data: article,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['article', id],
    queryFn: () => articlesApi.getArticle(Number(id)!),
  });

  // Handle loading state
  if (isLoading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-200 rounded w-3/4" />
        <div className="mt-4 h-4 bg-gray-200 rounded w-1/4" />
        <div className="mt-8 h-4 bg-gray-200 rounded" />
        <div className="mt-2 h-4 bg-gray-200 rounded" />
        <div className="mt-2 h-4 bg-gray-200 rounded w-5/6" />
      </div>
    );
  }

  // Handle error state
  if (isError || !article) {
    return (
      <div className="text-center text-red-500 mt-16">
        <h1>Oops!</h1>
        <p>We couldn&apos;t load the article. Please try again later.</p>
      </div>
    );
  }

  // Render article details
  return (
    <article className="prose lg:prose-xl mx-auto mt-10">
      {/* Article Title */}
      <h1 className="font-bold text-gray-900">{article.title}</h1>

      {/* Article Metadata */}
      <div className="flex items-center text-gray-500 text-sm mt-2">
        {article.source?.name && <span className="font-medium">{article.source.name}</span>}
        {article.published_at && (
          <>
            <span className="mx-2">•</span>
            <time dateTime={article.published_at}>
              {new Date(article.published_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </time>
          </>
        )}
        {article.author && (
          <>
            <span className="mx-2">•</span>
            <span className="font-medium">{article.author}</span>
          </>
        )}
      </div>

      {/* Article Image */}
      {article.image_url && (
        <img
          src={article.image_url}
          alt={article.title}
          className="my-8 rounded-lg shadow-lg w-full"
        />
      )}

      {/* Article Content */}
      {article.content ? (
        <div dangerouslySetInnerHTML={{ __html: article.content }} className="mt-6 text-gray-700" />
      ) : (
        <p className="text-gray-500">Content not available.</p>
      )}

      {/* Article URL */}
      {article.url && (
        <div className="mt-8">
          <a
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary font-medium hover:underline"
          >
            Read the full article
          </a>
        </div>
      )}
    </article>
  );
}
