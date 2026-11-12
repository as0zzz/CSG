import hashlib
import hmac
import os
from fastapi import Depends, HTTPException, Request
from itsdangerous import URLSafeTimedSerializer, BadSignature
from sqlalchemy import select
from sqlalchemy.orm import Session
from .db import session
from .models import User, Membership

signer = URLSafeTimedSerializer(os.environ['SESSION_SECRET'], salt='aksg-session')


def hash_password(password, salt=None):
    salt = salt or os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac('sha256', password.encode(), salt.encode(), 150000).hex()
    return f'{salt}:{digest}'


def verify_password(password, stored):
    return hmac.compare_digest(hash_password(password, stored.split(':')[0]), stored)


def current(request: Request, db: Session = Depends(session)):
    try:
        user_id = signer.loads(request.cookies.get('session', ''), max_age=43200)
    except BadSignature:
        raise HTTPException(401, 'Необходимо войти')
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(401, 'Необходимо войти')
    return user


def membership(db, user, project_id, roles=None):
    member = db.scalar(select(Membership).where(Membership.user_id == user.id, Membership.project_id == project_id))
    if not member or (roles and not set(member.roles).intersection(roles)):
        raise HTTPException(403, 'Нет доступа к проекту или действию')
    return member


def contractor_only(member):
    return set(member.roles) == {'ContractorManager'}
