import React from 'react';
import { Link } from 'react-router-dom';
import { Article } from '../../../types';

interface ArticleCardProps {
  article: Article;
}

export default function ArticleCard({ article }: ArticleCardProps) {
  console.log(article);
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {article.image_url && (
        <img className="h-48 w-full object-cover" src={article.image_url} alt={article.title} />
      )}
      <div className="p-6">
        <p className="text-sm font-medium text-primary-600">{article.source.name}</p>
        <Link to={`/articles/${article.id}`} className="mt-2 block">
          <p className="text-xl font-semibold text-gray-900">{article.title}</p>
          <p className="mt-3 text-base text-gray-500">{article.description}</p>
        </Link>
        <div className="mt-6 flex items-center">
          <div className="flex-shrink-0">
            <span className="sr-only">{article.author}</span>
          </div>
          <div className="ml-3">
            <p className="text-sm font-medium text-gray-900">{article.author}</p>
            <div className="flex space-x-1 text-sm text-gray-500">
              <time dateTime={article.published_at}>
                {new Date(article.published_at).toLocaleDateString()}
              </time>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
