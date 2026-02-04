import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { env } from "./env.js";
import { findUserByEmail, createUser } from "../modules/auth/auth.service.js";

passport.use(
  new GoogleStrategy(
    {
      clientID: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackURL: "/api/auth/google/callback",
    },
    async (_, __, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;
        const name = profile.displayName;

        if (!email) {
          return done(new Error("Google account has no email"), null);
        }

        let user = await findUserByEmail(email);

        // Case 1: user exists (local or google)
        if (user) {
          return done(null, user);
        }

        // Case 2: new Google user
        user = await createUser({
          name,
          email,
          provider: "google",
          password: null,
        });

        return done(null, user);
      } catch (err) {
        return done(err, null);
      }
    },
  ),
);

export default passport;
