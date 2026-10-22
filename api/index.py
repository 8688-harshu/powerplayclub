"""
Vercel Serverless Function entrypoint for PowerPlay Club Booking API
"""
import sys
import os

# Add parent directory to sys.path so server module imports work cleanly
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.main import app
