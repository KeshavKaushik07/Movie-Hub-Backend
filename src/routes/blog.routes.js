import { Router } from 'express';
import {
  listBlogs,
  getBlog,
  createBlog,
  updateBlog,
  deleteBlog,
  toggleBlogLike,
  listBlogComments,
  addBlogComment,
  toggleBlogCommentLike,
  deleteBlogComment,
  moderateBlogComment,
  previewMovieAssetsForBlog,
} from '../controller/blog.controller.js';
import { protect, optionalAuth, authorize } from '../middleware/auth.middleware.js';

const r = Router();

// Admin & SuperAdmin helper: Fetch movie poster/backdrop/gallery URLs by movie tmdbId
r.get(
  '/movie-assets/:type/:tmdbId',
  protect,
  authorize('admin', 'superadmin'),
  previewMovieAssetsForBlog,
);
r.get(
  '/movie-assets/:tmdbId',
  protect,
  authorize('admin', 'superadmin'),
  previewMovieAssetsForBlog,
);

// Public / OptionalAuth blog listing & reading
r.get('/', optionalAuth, listBlogs);
r.get('/:slugOrId', optionalAuth, getBlog);

// Admin & SuperAdmin blog CRUD
r.post('/', protect, authorize('admin', 'superadmin'), createBlog);
r.patch('/:id', protect, authorize('admin', 'superadmin'), updateBlog);
r.delete('/:id', protect, authorize('admin', 'superadmin'), deleteBlog);

// User Blog Likes & Threaded Comments
r.post('/:id/like', protect, toggleBlogLike);
r.get('/:id/comments', optionalAuth, listBlogComments);
r.post('/:id/comments', protect, addBlogComment);
r.post('/comments/:commentId/like', protect, toggleBlogCommentLike);
r.patch('/comments/:commentId', protect, authorize('admin', 'superadmin'), moderateBlogComment);
r.delete('/comments/:commentId', protect, deleteBlogComment);

export default r;
