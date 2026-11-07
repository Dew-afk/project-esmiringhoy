def test_login_rate_limited(client, world):
    from app.core.limiter import limiter

    limiter.enabled = True
    limiter.reset()
    try:
        for _ in range(5):
            r = client.post("/api/v1/auth/login",
                            json={"email": "stu@a.edu", "password": "pw123456"})
            assert r.status_code == 200
        r = client.post("/api/v1/auth/login",
                        json={"email": "stu@a.edu", "password": "pw123456"})
        assert r.status_code == 429
    finally:
        limiter.reset()
        limiter.enabled = False
